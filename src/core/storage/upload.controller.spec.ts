import { ForbiddenException } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { StorageService } from './storage.service';
import { ImageService } from './image.service';
import { ClamAvService } from './clamav.service';
import { JwtPayload } from '../../modules/auth/strategies/jwt.strategy';

const makeStorageMock = () => ({
  upload: jest.fn().mockResolvedValue('https://cdn.example.com/key'),
  delete: jest.fn().mockResolvedValue(undefined),
});

const makeImageMock = () => ({
  processAvatar: jest
    .fn()
    .mockResolvedValue({ buffer: Buffer.from('processed'), mimeType: 'image/webp' }),
});

const makeClamAvMock = () => ({ scanOrThrow: jest.fn().mockResolvedValue(undefined) });

const makeController = () => {
  const storage = makeStorageMock();
  const image = makeImageMock();
  const clamav = makeClamAvMock();
  const controller = new UploadController(
    storage as unknown as StorageService,
    image as unknown as ImageService,
    clamav as unknown as ClamAvService,
  );
  return { controller, storage, image, clamav };
};

const makeUser = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'user-id-1',
  email: 'test@example.com',
  roles: ['user'],
  ...overrides,
});

const makeFile = (overrides: Partial<Express.Multer.File> = {}): Express.Multer.File =>
  ({
    buffer: Buffer.from('file-contents'),
    originalname: 'photo.png',
    mimetype: 'image/png',
    ...overrides,
  }) as Express.Multer.File;

describe('UploadController', () => {
  describe('uploadAvatar()', () => {
    it('scans the file for viruses before processing', async () => {
      const { controller, clamav } = makeController();
      const file = makeFile();
      await controller.uploadAvatar(file, makeUser());
      expect(clamav.scanOrThrow).toHaveBeenCalledWith(file.buffer);
    });

    it('rejects the upload when the virus scan throws', async () => {
      const { controller, clamav, image } = makeController();
      clamav.scanOrThrow.mockRejectedValue(new Error('virus detected'));
      await expect(controller.uploadAvatar(makeFile(), makeUser())).rejects.toThrow(
        'virus detected',
      );
      expect(image.processAvatar).not.toHaveBeenCalled();
    });

    it('uploads under avatars/{userId}/ with a .webp extension', async () => {
      const { controller, storage } = makeController();
      await controller.uploadAvatar(makeFile(), makeUser({ sub: 'distinct-user' }));
      const [key] = storage.upload.mock.calls[0];
      expect(key).toMatch(/^avatars\/distinct-user\/.+\.webp$/);
    });

    it('uploads the processed buffer with the processed mime type', async () => {
      const { controller, storage, image } = makeController();
      image.processAvatar.mockResolvedValue({
        buffer: Buffer.from('resized'),
        mimeType: 'image/webp',
      });
      await controller.uploadAvatar(makeFile(), makeUser());
      expect(storage.upload).toHaveBeenCalledWith(
        expect.any(String),
        Buffer.from('resized'),
        'image/webp',
      );
    });

    it('returns the uploaded url', async () => {
      const { controller, storage } = makeController();
      storage.upload.mockResolvedValue('https://cdn.example.com/avatar.webp');
      const result = await controller.uploadAvatar(makeFile(), makeUser());
      expect(result).toEqual({ url: 'https://cdn.example.com/avatar.webp' });
    });
  });

  describe('uploadFile()', () => {
    it('scans the file for viruses before uploading', async () => {
      const { controller, clamav } = makeController();
      const file = makeFile();
      await controller.uploadFile(file, makeUser());
      expect(clamav.scanOrThrow).toHaveBeenCalledWith(file.buffer);
    });

    it('rejects the upload when the virus scan throws', async () => {
      const { controller, clamav, storage } = makeController();
      clamav.scanOrThrow.mockRejectedValue(new Error('virus detected'));
      await expect(controller.uploadFile(makeFile(), makeUser())).rejects.toThrow('virus detected');
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('uploads under uploads/{userId}/ preserving the original extension', async () => {
      const { controller, storage } = makeController();
      await controller.uploadFile(
        makeFile({ originalname: 'report.pdf' }),
        makeUser({ sub: 'distinct-user' }),
      );
      const [key] = storage.upload.mock.calls[0];
      expect(key).toMatch(/^uploads\/distinct-user\/.+\.pdf$/);
    });

    it('uses the filename itself as the extension when there is no dot', async () => {
      const { controller, storage } = makeController();
      await controller.uploadFile(makeFile({ originalname: 'noext' }), makeUser());
      const [key] = storage.upload.mock.calls[0];
      expect(key).toMatch(/\.noext$/);
    });

    it('uploads the raw file buffer and mimetype unchanged', async () => {
      const { controller, storage } = makeController();
      const file = makeFile({ mimetype: 'application/pdf' });
      await controller.uploadFile(file, makeUser());
      expect(storage.upload).toHaveBeenCalledWith(
        expect.any(String),
        file.buffer,
        'application/pdf',
        expect.objectContaining({ metadata: expect.anything() }),
      );
    });

    it('returns the uploaded url and key', async () => {
      const { controller, storage } = makeController();
      storage.upload.mockResolvedValue('https://cdn.example.com/uploads/x.pdf');
      const result = await controller.uploadFile(makeFile(), makeUser());
      expect(result.url).toBe('https://cdn.example.com/uploads/x.pdf');
      expect(result.key).toMatch(/^uploads\//);
    });
  });

  describe('deleteFile()', () => {
    it('deletes a key owned by the user under avatars/', async () => {
      const { controller, storage } = makeController();
      await controller.deleteFile('avatars/user-id-1/photo.webp', makeUser());
      expect(storage.delete).toHaveBeenCalledWith('avatars/user-id-1/photo.webp');
    });

    it('deletes a key owned by the user under uploads/', async () => {
      const { controller, storage } = makeController();
      await controller.deleteFile('uploads/user-id-1/report.pdf', makeUser());
      expect(storage.delete).toHaveBeenCalledWith('uploads/user-id-1/report.pdf');
    });

    it('throws ForbiddenException for a key owned by another user', async () => {
      const { controller, storage } = makeController();
      await expect(
        controller.deleteFile('avatars/other-user/photo.webp', makeUser()),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a key outside avatars/uploads prefixes', async () => {
      const { controller, storage } = makeController();
      await expect(controller.deleteFile('other/user-id-1/file.txt', makeUser())).rejects.toThrow(
        ForbiddenException,
      );
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });
});

const mockApiRequest = jest.fn();
const mockPhotos: {
  photoId: string;
  incidentId: string;
  uri: string;
  attempts: number;
  nextAttemptAt: string | null;
}[] = [
  {
    photoId: 'photo-id',
    incidentId: 'incident-id',
    uri: 'file:///photo.jpg',
    attempts: 0,
    nextAttemptAt: null,
  },
];
const mockRepository = {
  listIncidentPhotos: jest.fn(async () => mockPhotos),
  retryIncidentPhoto: jest.fn(async (_id: string, attempts: number, nextAttemptAt: string) => {
    const photo = mockPhotos[0];
    if (photo) Object.assign(photo, { attempts, nextAttemptAt });
  }),
  removeIncidentPhoto: jest.fn(async () => {
    mockPhotos.splice(0);
  }),
  getSyncMeta: jest.fn(async () => 'false'),
  countPendingEvents: jest.fn(async () => 0),
  clearShiftData: jest.fn(async () => undefined),
  setSyncMeta: jest.fn(async () => undefined),
};
const mockUpload = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));
jest.mock('@/lib/db/database', () => ({
  createDefaultFieldRepository: async () => mockRepository,
}));
jest.mock('@/lib/cola/credential', () => ({
  getShiftCredentialToken: async () => 'shift-token',
  deleteShiftCredential: async () => undefined,
}));
jest.mock('expo-file-system', () => ({
  File: class {
    upload = mockUpload;
    delete = jest.fn();
    constructor(_uri: string) {}
  },
  UploadType: { MULTIPART: 1 },
}));

import { act } from '@testing-library/react-native';
import { resetIncidentPhotoQueueForTesting, processIncidentPhotos } from './photo-queue';

describe('processIncidentPhotos', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPhotos.splice(0, mockPhotos.length, {
      photoId: 'photo-id',
      incidentId: 'incident-id',
      uri: 'file:///photo.jpg',
      attempts: 0,
      nextAttemptAt: null,
    });
    mockApiRequest.mockReset();
    mockUpload.mockReset();
    mockRepository.retryIncidentPhoto.mockClear();
    mockRepository.removeIncidentPhoto.mockClear();
    resetIncidentPhotoQueueForTesting();
  });
  afterEach(() => jest.useRealTimers());

  it('keeps a photo after a failed upload and removes it after a retry succeeds', async () => {
    mockApiRequest.mockImplementation((_method: string, path: string) =>
      Promise.resolve(
        path.endsWith('/autorizacion')
          ? {
              cloudName: 'test',
              apiKey: 'key',
              publicId: 'incidentes/company/incident/photo',
              timestamp: 1,
              signature: 'sig',
              type: 'authenticated',
              uploadUrl: 'https://api.cloudinary.com/upload',
              maxBytes: 3_145_728,
            }
          : { id: 'photo-row' },
      ),
    );
    mockUpload.mockRejectedValueOnce(new Error('sin señal')).mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({
        public_id: 'incidentes/company/incident/photo',
        type: 'authenticated',
        width: 100,
        height: 80,
        bytes: 1000,
      }),
    });
    await act(async () => processIncidentPhotos());
    expect(mockPhotos).toHaveLength(1);
    expect(mockRepository.retryIncidentPhoto).toHaveBeenCalledWith(
      'photo-id',
      1,
      expect.any(String),
    );

    mockPhotos[0]!.nextAttemptAt = null;
    await act(async () => processIncidentPhotos());
    expect(mockRepository.removeIncidentPhoto).toHaveBeenCalledWith('photo-id');
    expect(mockPhotos).toHaveLength(0);
  });
});

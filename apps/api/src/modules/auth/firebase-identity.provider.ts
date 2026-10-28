import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Env } from '../../config/env';
import type { FirebaseIdentityProvider } from './auth.types';

@Injectable()
export class FirebaseAdminIdentityProvider implements FirebaseIdentityProvider {
  constructor(config: ConfigService<Env, true>) {
    if (!getApps().length && config.get('NODE_ENV', { infer: true }) !== 'test') {
      initializeApp({
        credential: cert({
          projectId: config.getOrThrow('FIREBASE_PROJECT_ID', { infer: true }),
          clientEmail: config.getOrThrow('FIREBASE_CLIENT_EMAIL', { infer: true }),
          privateKey: config
            .getOrThrow('FIREBASE_PRIVATE_KEY', { infer: true })
            .replace(/\\n/g, '\n'),
        }),
      });
    }
  }

  async verifyIdToken(token: string): Promise<{ uid: string }> {
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid };
  }

  async createDisabledUser(email: string): Promise<{ uid: string }> {
    const user = await getAuth().createUser({ email, disabled: true });
    return { uid: user.uid };
  }

  async deleteUser(uid: string): Promise<void> {
    await getAuth().deleteUser(uid);
  }

  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    await getAuth().updateUser(uid, { disabled });
  }

  async revokeRefreshTokens(uid: string): Promise<void> {
    await getAuth().revokeRefreshTokens(uid);
  }

  generatePasswordResetLink(email: string): Promise<string> {
    return getAuth().generatePasswordResetLink(email);
  }
}

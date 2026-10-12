import { z } from 'zod';

export const USER_STATUSES = ['invitation_pending', 'active', 'deactivated'] as const;
export const userStatusSchema = z.enum(USER_STATUSES);
export const ALLOWED_CHANNELS = ['web', 'mobile'] as const;
export const allowedChannelSchema = z.enum(ALLOWED_CHANNELS);
export const allowedChannelsSchema = z.array(allowedChannelSchema);

export const authMeResponseSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  role: z.enum(['admin', 'supervisor', 'guard', 'client']),
  status: userStatusSchema,
  company: z.object({ id: z.string(), name: z.string() }),
  allowedChannels: allowedChannelsSchema,
});

export type UserStatus = z.infer<typeof userStatusSchema>;
export type AllowedChannel = z.infer<typeof allowedChannelSchema>;
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

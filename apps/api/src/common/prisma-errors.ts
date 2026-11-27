import { Prisma } from '../generated/prisma/client';

/** Error conocido de Prisma con alguno de esos códigos (p. ej. P2002 clave única, P2034 serialización). */
export function isPrismaError(error: unknown, ...codes: string[]): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && codes.includes(error.code);
}

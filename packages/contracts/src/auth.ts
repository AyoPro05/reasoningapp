import { z } from 'zod';
import { OpaqueId } from './session.js';

export const LearnerDto = z.strictObject({ userId: OpaqueId });
export type LearnerDto = z.infer<typeof LearnerDto>;
export const PracticeAccessDto = z.strictObject({ allowed: z.literal(true) });
export type PracticeAccessDto = z.infer<typeof PracticeAccessDto>;

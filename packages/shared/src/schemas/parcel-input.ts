import { z } from 'zod';

/**
 * Zod schema for the address block in a parcel input.
 */
export const addressInputSchema = z.object({
  street: z.string().min(1, 'street is required'),
  houseNumber: z.string().min(1, 'houseNumber is required'),
  postalCode: z.string().min(1, 'postalCode is required'),
  city: z.string().min(1, 'city is required'),
}).strict();

/**
 * Zod schema for the recipient block in a parcel input.
 */
export const recipientInputSchema = z.object({
  name: z.string().min(1, 'recipient name is required'),
  address: addressInputSchema,
}).strict();

/**
 * Zod schema for a single parcel input (POST /parcels body).
 *
 * This validates the EXTERNAL input shape. The repository adds
 * internal fields (_id, status, correlationId, etc.) before insertion.
 */
export const parcelInputSchema = z.object({
  weight: z.number({ invalid_type_error: 'weight must be a number' })
    .nonnegative('weight must be non-negative'),
  value: z.number({ invalid_type_error: 'value must be a number' })
    .nonnegative('value must be non-negative'),
  destinationCountry: z.string().min(1, 'destinationCountry is required'),
  recipient: recipientInputSchema,
  custom: z.record(z.unknown()).optional().default({}),
}).strict();

/** Input type for a single parcel (inferred from Zod). */
export type ParcelInput = z.infer<typeof parcelInputSchema>;

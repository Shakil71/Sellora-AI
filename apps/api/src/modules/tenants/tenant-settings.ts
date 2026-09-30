import { z } from 'zod';

export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** Lower-case city names; empty list with `countries` means the whole country */
  cities: z.array(z.string().trim().min(1).max(80)).max(200).default([]),
  countries: z.array(z.string().trim().min(2).max(60)).max(50).default([]),
  fee: z.number().min(0).max(1_000_000).default(0),
  etaDays: z.number().int().min(0).max(90).default(3),
});

export const commerceSettingsSchema = z.object({
  taxRatePercent: z.number().min(0).max(100).default(0),
  defaultShippingFee: z.number().min(0).max(1_000_000).default(0),
  freeShippingThreshold: z.number().min(0).max(100_000_000).nullable().default(null),
  /** reserve: stock is reserved on order and deducted on shipment; deduct: deducted immediately */
  inventoryMode: z.enum(['reserve', 'deduct']).default('reserve'),
  allowBackorders: z.boolean().default(false),
  orderPrefix: z.string().trim().min(1).max(8).regex(/^[A-Z0-9-]+$/i).default('ORD'),
  invoicePrefix: z.string().trim().min(1).max(8).regex(/^[A-Z0-9-]+$/i).default('INV'),
  invoiceDueDays: z.number().int().min(0).max(365).default(7),
  deliveryZones: z.array(deliveryZoneSchema).max(100).default([]),
  paymentMethods: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .default(['cash_on_delivery', 'bank_transfer', 'card', 'mobile_wallet']),
  aiCanCreateOrders: z.boolean().default(true),
  sendOrderConfirmation: z.boolean().default(true),
});

export type CommerceSettings = z.infer<typeof commerceSettingsSchema>;
export type DeliveryZone = z.infer<typeof deliveryZoneSchema>;

export function readCommerceSettings(raw: unknown): CommerceSettings {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).commerce ?? raw : {};
  const parsed = commerceSettingsSchema.safeParse(source ?? {});
  return parsed.success ? parsed.data : commerceSettingsSchema.parse({});
}

export function findDeliveryZone(settings: CommerceSettings, city?: string, country?: string): DeliveryZone | undefined {
  const c = city?.trim().toLowerCase();
  const k = country?.trim().toLowerCase();
  return (
    settings.deliveryZones.find((z) => c && z.cities.some((x) => x.toLowerCase() === c)) ??
    settings.deliveryZones.find((z) => z.cities.length === 0 && k && z.countries.some((x) => x.toLowerCase() === k)) ??
    settings.deliveryZones.find((z) => z.cities.length === 0 && z.countries.length === 0)
  );
}

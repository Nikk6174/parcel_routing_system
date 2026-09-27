import { describe, it, expect } from 'vitest';
import { resolveField } from './field-resolver.js';
import type { Parcel } from './types.js';

const testParcel: Parcel = {
  weight: 12,
  value: 500,
  destinationCountry: 'NL',
  recipient: {
    name: 'Jan de Vries',
    address: {
      street: 'Keizersgracht',
      houseNumber: '100',
      postalCode: '1015 AA',
      city: 'Amsterdam',
    },
  },
  custom: {
    fragile: true,
    priority: 'express',
  },
};

describe('resolveField', () => {
  // ── Happy path ──────────────────────────────────────
  it('resolves top-level system field "weight"', () => {
    expect(resolveField(testParcel, 'weight')).toBe(12);
  });

  it('resolves top-level system field "destinationCountry"', () => {
    expect(resolveField(testParcel, 'destinationCountry')).toBe('NL');
  });

  it('resolves nested system field "recipient.name"', () => {
    expect(resolveField(testParcel, 'recipient.name')).toBe('Jan de Vries');
  });

  it('resolves deeply nested field "recipient.address.city"', () => {
    expect(resolveField(testParcel, 'recipient.address.city')).toBe('Amsterdam');
  });

  it('resolves custom field "custom.fragile"', () => {
    expect(resolveField(testParcel, 'custom.fragile')).toBe(true);
  });

  it('resolves custom field "custom.priority"', () => {
    expect(resolveField(testParcel, 'custom.priority')).toBe('express');
  });

  // ── Boundary ────────────────────────────────────────
  it('returns undefined for valid path to missing custom sub-key', () => {
    expect(resolveField(testParcel, 'custom.nonexistent')).toBeUndefined();
  });

  it('returns undefined for valid path to missing nested system field', () => {
    expect(
      resolveField(testParcel, 'recipient.address.country'),
    ).toBeUndefined();
  });

  // ── Invalid input ───────────────────────────────────
  it('throws for unknown top-level field', () => {
    expect(() => resolveField(testParcel, 'foo')).toThrow(
      'Unknown top-level field',
    );
  });

  it('throws for empty field path', () => {
    expect(() => resolveField(testParcel, '')).toThrow('cannot be empty');
  });

  it('throws for bare "custom" without sub-key', () => {
    expect(() => resolveField(testParcel, 'custom')).toThrow(
      'requires a sub-key',
    );
  });

  // ── Custom field shadowing protection ───────────────
  it('system field "weight" is NOT shadowed by custom.weight', () => {
    const parcelWithShadow: Parcel = {
      ...testParcel,
      custom: { weight: 999 },
    };

    // "weight" resolves to system field (12), not custom.weight (999)
    expect(resolveField(parcelWithShadow, 'weight')).toBe(12);
    // "custom.weight" explicitly resolves to the custom namespace
    expect(resolveField(parcelWithShadow, 'custom.weight')).toBe(999);
  });
});

import type { GstHstValidationResult } from "@/domain/types";

const gstHstPattern = /^\d{9}RT\d{4}$/;

export function validateGstHstNumberFormat(value: string | null | undefined): GstHstValidationResult {
  if (value === null || value === undefined || value.trim() === "") {
    return { status: "missing", normalizedNumber: null, reasonCode: "GST_HST_NUMBER_MISSING" };
  }
  const normalizedNumber = value.replace(/\s/g, "").toUpperCase();
  if (/ignore|system|prompt|instruction/i.test(normalizedNumber)) {
    return { status: "suspicious", normalizedNumber: null, reasonCode: "GST_HST_NUMBER_SUSPICIOUS" };
  }
  if (!/^[A-Z0-9]+$/.test(normalizedNumber)) {
    return { status: "malformed", normalizedNumber: null, reasonCode: "GST_HST_NUMBER_MALFORMED" };
  }
  if (!gstHstPattern.test(normalizedNumber)) {
    return { status: "invalid_format", normalizedNumber: null, reasonCode: "GST_HST_NUMBER_INVALID_FORMAT" };
  }
  return { status: "valid_format", normalizedNumber, reasonCode: "GST_HST_NUMBER_VALID_FORMAT_ONLY" };
}

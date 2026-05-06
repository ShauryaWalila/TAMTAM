/**
 * Utility functions for merchant extraction and other app logic.
 */

/**
 * Extracts the merchant name from a raw SMS transaction text.
 * Common patterns:
 * - "at [Merchant] using"
 * - "to [Merchant] via"
 * - "at [Merchant] on"
 * 
 * @param rawText The full SMS content
 * @returns Cleaned merchant name or "Unknown Merchant"
 */
export const extractMerchantName = (rawText: string): string => {
  if (!rawText) return 'Unknown Merchant';
  
  // Pattern: ... at [Merchant] using ...
  const atUsingMatch = rawText.match(/at\s+(.+?)\s+using/i);
  if (atUsingMatch && atUsingMatch[1]) return cleanMerchant(atUsingMatch[1]);
  
  // Pattern: ... to [Merchant] via ...
  const toViaMatch = rawText.match(/to\s+(.+?)\s+via/i);
  if (toViaMatch && toViaMatch[1]) return cleanMerchant(toViaMatch[1]);

  // Fallback pattern: ... at [Merchant] on ...
  const atOnMatch = rawText.match(/at\s+(.+?)\s+on/i);
  if (atOnMatch && atOnMatch[1]) return cleanMerchant(atOnMatch[1]);

  return 'Unknown Merchant';
};

/**
 * Extracts the numerical amount from a raw SMS transaction text.
 * Removes currency symbols (₹, $, etc.) and commas.
 * 
 * @param rawText The full SMS content
 * @returns Cleaned amount as a number or 0 if not found
 */
export const extractSMSAmount = (rawText: string): number => {
  if (!rawText) return 0;
  
  // Look for patterns like INR 500, Rs 500, ₹500, or just 500.00
  const amountMatch = rawText.match(/(?:INR|Rs|₹|Rs\.)\s*([\d,]+(?:\.\d{2})?)/i) || 
                      rawText.match(/(\d+[,.]\d{2})/);
                      
  if (amountMatch && amountMatch[1]) {
    const cleaned = amountMatch[1].replace(/,/g, '');
    return parseFloat(cleaned) || 0;
  }
  
  return 0;
};

/**
 * Helper to remove extra whitespace or common suffixes from merchant names.
 */
export const cleanMerchant = (name: string): string => {
  return name.trim().split(/\s{2,}/)[0].trim();
};

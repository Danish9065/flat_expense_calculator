import { normalizeWhatsAppNumber } from './paymentLinks';

export interface CountryDialCode {
  iso: string;
  name: string;
  dialCode: string;
}

// India is intentionally first because it is SplitMate's default market. The
// native select remains searchable/scrollable through the operating system.
export const COUNTRY_DIAL_CODES: CountryDialCode[] = [
  { iso: 'IN', name: 'India', dialCode: '91' },
  { iso: 'US', name: 'United States / Canada', dialCode: '1' },
  { iso: 'AE', name: 'United Arab Emirates', dialCode: '971' },
  { iso: 'AF', name: 'Afghanistan', dialCode: '93' },
  { iso: 'AU', name: 'Australia', dialCode: '61' },
  { iso: 'BD', name: 'Bangladesh', dialCode: '880' },
  { iso: 'BE', name: 'Belgium', dialCode: '32' },
  { iso: 'BH', name: 'Bahrain', dialCode: '973' },
  { iso: 'BR', name: 'Brazil', dialCode: '55' },
  { iso: 'BT', name: 'Bhutan', dialCode: '975' },
  { iso: 'CH', name: 'Switzerland', dialCode: '41' },
  { iso: 'CN', name: 'China', dialCode: '86' },
  { iso: 'DE', name: 'Germany', dialCode: '49' },
  { iso: 'DK', name: 'Denmark', dialCode: '45' },
  { iso: 'EG', name: 'Egypt', dialCode: '20' },
  { iso: 'ES', name: 'Spain', dialCode: '34' },
  { iso: 'FI', name: 'Finland', dialCode: '358' },
  { iso: 'FR', name: 'France', dialCode: '33' },
  { iso: 'GB', name: 'United Kingdom', dialCode: '44' },
  { iso: 'GH', name: 'Ghana', dialCode: '233' },
  { iso: 'GR', name: 'Greece', dialCode: '30' },
  { iso: 'HK', name: 'Hong Kong', dialCode: '852' },
  { iso: 'ID', name: 'Indonesia', dialCode: '62' },
  { iso: 'IE', name: 'Ireland', dialCode: '353' },
  { iso: 'IL', name: 'Israel', dialCode: '972' },
  { iso: 'IQ', name: 'Iraq', dialCode: '964' },
  { iso: 'IR', name: 'Iran', dialCode: '98' },
  { iso: 'IT', name: 'Italy', dialCode: '39' },
  { iso: 'JP', name: 'Japan', dialCode: '81' },
  { iso: 'KE', name: 'Kenya', dialCode: '254' },
  { iso: 'KR', name: 'South Korea', dialCode: '82' },
  { iso: 'KW', name: 'Kuwait', dialCode: '965' },
  { iso: 'LK', name: 'Sri Lanka', dialCode: '94' },
  { iso: 'MM', name: 'Myanmar', dialCode: '95' },
  { iso: 'MV', name: 'Maldives', dialCode: '960' },
  { iso: 'MY', name: 'Malaysia', dialCode: '60' },
  { iso: 'NG', name: 'Nigeria', dialCode: '234' },
  { iso: 'NL', name: 'Netherlands', dialCode: '31' },
  { iso: 'NO', name: 'Norway', dialCode: '47' },
  { iso: 'NP', name: 'Nepal', dialCode: '977' },
  { iso: 'NZ', name: 'New Zealand', dialCode: '64' },
  { iso: 'OM', name: 'Oman', dialCode: '968' },
  { iso: 'PK', name: 'Pakistan', dialCode: '92' },
  { iso: 'PL', name: 'Poland', dialCode: '48' },
  { iso: 'PT', name: 'Portugal', dialCode: '351' },
  { iso: 'QA', name: 'Qatar', dialCode: '974' },
  { iso: 'RU', name: 'Russia / Kazakhstan', dialCode: '7' },
  { iso: 'SA', name: 'Saudi Arabia', dialCode: '966' },
  { iso: 'SE', name: 'Sweden', dialCode: '46' },
  { iso: 'SG', name: 'Singapore', dialCode: '65' },
  { iso: 'TH', name: 'Thailand', dialCode: '66' },
  { iso: 'TR', name: 'Turkey', dialCode: '90' },
  { iso: 'TW', name: 'Taiwan', dialCode: '886' },
  { iso: 'TZ', name: 'Tanzania', dialCode: '255' },
  { iso: 'UG', name: 'Uganda', dialCode: '256' },
  { iso: 'VN', name: 'Vietnam', dialCode: '84' },
  { iso: 'ZA', name: 'South Africa', dialCode: '27' },
];

export function getCountryDialCode(iso: string) {
  return COUNTRY_DIAL_CODES.find((country) => country.iso === iso) || COUNTRY_DIAL_CODES[0];
}

export function sanitizeLocalPhoneNumber(value: string) {
  return value.replace(/\D/g, '').slice(0, 12);
}

export function buildInternationalWhatsAppNumber(countryIso: string, localNumber: string) {
  const country = getCountryDialCode(countryIso);
  const local = sanitizeLocalPhoneNumber(localNumber);
  if (!local || local.startsWith('0')) return null;
  if (country.iso === 'IN' && !/^[6-9][0-9]{9}$/.test(local)) return null;
  if (country.iso !== 'IN' && !/^[1-9][0-9]{5,11}$/.test(local)) return null;
  return normalizeWhatsAppNumber(`${country.dialCode}${local}`);
}

export function splitInternationalWhatsAppNumber(value?: string | null, defaultIso = 'IN') {
  const digits = String(value || '').replace(/\D/g, '');
  const fallback = getCountryDialCode(defaultIso);
  if (!digits) return { countryIso: fallback.iso, localNumber: '' };

  // Legacy SplitMate profiles stored Indian 10-digit numbers without +91.
  if (/^[6-9][0-9]{9}$/.test(digits)) {
    return { countryIso: 'IN', localNumber: digits };
  }

  const matchingCountry = [...COUNTRY_DIAL_CODES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((country) => {
      const local = digits.slice(country.dialCode.length);
      return digits.startsWith(country.dialCode) && /^[1-9][0-9]{5,11}$/.test(local);
    });

  return matchingCountry
    ? { countryIso: matchingCountry.iso, localNumber: digits.slice(matchingCountry.dialCode.length) }
    : { countryIso: fallback.iso, localNumber: digits };
}

export function formatInternationalPhone(value?: string | null) {
  const parsed = splitInternationalWhatsAppNumber(value);
  const country = getCountryDialCode(parsed.countryIso);
  return parsed.localNumber ? `+${country.dialCode} ${parsed.localNumber}` : 'Not added';
}

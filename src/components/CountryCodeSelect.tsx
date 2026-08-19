import { COUNTRY_DIAL_CODES } from '../lib/countryPhone';

interface CountryCodeSelectProps {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  disabled?: boolean;
}

export default function CountryCodeSelect({ id, value, onChange, className = '', disabled = false }: CountryCodeSelectProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label="Country calling code"
      className={className}
    >
      {COUNTRY_DIAL_CODES.map((country) => (
        <option key={country.iso} value={country.iso}>
          {country.name} (+{country.dialCode})
        </option>
      ))}
    </select>
  );
}

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

/** Six boxes for an authenticator code; the number pad on a phone, and the phone's own code suggestion. */
export function CodeInput({ value, onChange, onComplete, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={(v) => onChange(v.replace(/\D/g, ""))}
      onComplete={onComplete}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="^[0-9]*$"
      autoFocus
      disabled={disabled}
      containerClassName="justify-center"
    >
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}

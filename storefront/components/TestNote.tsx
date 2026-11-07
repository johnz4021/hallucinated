import { isTestMode } from "@/lib/mode";

export default function TestNote() {
  if (!isTestMode()) return null;
  return <p className="test-note">Checkout is in Stripe test mode: nothing is charged. Test card 4242 4242 4242 4242, any future date, any CVC.</p>;
}

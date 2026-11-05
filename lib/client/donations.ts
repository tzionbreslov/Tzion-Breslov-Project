/**
 * Donation tiers and the checkout hand-off. PayPal is intentionally not wired
 * yet: `beginCheckout` is the single place to add the PayPal JS SDK
 * (Orders API for one-time gifts, Subscriptions API for monthly) once a
 * client ID / plan IDs exist (NEXT_PUBLIC_PAYPAL_CLIENT_ID).
 */

export type Frequency = "monthly" | "one-time";

export const DONATION_TIERS = [
  { amount: 100, label: "Sponsor a Live Lesson" },
  { amount: 150, label: "Sponsor a Week of Short, Inspirational Clips" },
  { amount: 300, label: "Sponsor Two Weeks of Short, Inspirational Clips" },
  { amount: 600, label: "Sponsor a Full Month of Short, Inspirational Clips" }
] as const;

export const MIN_CUSTOM_AMOUNT = 5;
export const MAX_CUSTOM_AMOUNT = 100_000;

export type DonationDetails = {
  amount: number;
  frequency: Frequency;
  dedication: string;
  name: string;
  email: string;
};

export type CheckoutResult = { status: "redirect"; url: string } | { status: "unavailable" };

export async function beginCheckout(details: DonationDetails, paypalClientId: string): Promise<CheckoutResult> {
  void details;
  if (!paypalClientId) return { status: "unavailable" };
  // TODO(paypal): load https://www.paypal.com/sdk/js?client-id=…&vault=true&intent=subscription
  // and create an order (one-time) or subscription (monthly) for `details`.
  return { status: "unavailable" };
}

export const formatUsd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

// Shared order details for every process that runs our tools (order_run.mjs and serve.mjs).
// John approved these for Customania checkout: agent inbox for confirmations, his name for pickup, his billing address.
export const CONTACT = { email: process.env.ORDER_EMAIL || "hallucinated@agentmail.to", first: "John", last: "Zhang" };
export const BILLING = { first: "John", last: "Zhang", address1: "1616 E 56th St", city: "Chicago", state: "Illinois", zip: "60637", country: "United States" };

// What each drop prints, so every sales batch is ordered exactly like drop #1 (order CF5A93CRK):
// front = the Hallucinated wordmark 10 in wide, 1.5 in down; back = the approved design 11 in wide, 1 in down.
export const DROPS = {
  "drop-1": { design_id: "bc1dbe9d9aae", front: { design: "logo.png", width_in: 10, top_in: 1.5 }, back: { width_in: 11, top_in: 1 } },
};
// What Customania can actually make for store orders: (design, garment, color) -> print spec. Anything a customer buys that
// isn't here is never guessed at: stripe_orders flags it to John. Today: the black Men's Premium Tee with drop #1's design.
export const MAKEABLE = [
  { design_id: "bc1dbe9d9aae", garment: "tee", color: "black", ...DROPS["drop-1"] },
];

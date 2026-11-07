// Shared order details for every process that runs our tools (order_run.mjs and serve.mjs).
// John approved these for Customania checkout: agent inbox for confirmations, his name for pickup, his billing address.
export const CONTACT = { email: process.env.ORDER_EMAIL || "hallucinated@agentmail.to", first: "John", last: "Zhang" };
export const BILLING = { first: "John", last: "Zhang", address1: "1616 E 56th St", city: "Chicago", state: "Illinois", zip: "60637", country: "United States" };

/**
 * Code Fixture — Quality Eval
 *
 * A realistic TypeScript module with varied structures for compression quality eval.
 *
 * Key facts to preserve:
 *   - File path: src/services/paymentService.ts
 *   - Imports: 5 import lines
 *   - Exports: 3 named + 1 default
 *   - Types/interfaces: PaymentRequest, PaymentResponse, PaymentError
 *   - Public APIs: processPayment, refundPayment, getPaymentStatus, validateCard
 *   - TODO/FIXME: 2 (rate limiting, pino logger)
 *   - Error handling: try/catch in processPayment
 *   - Regex patterns: credit card validation
 */

export interface PaymentRequest {
  amount: number;
  currency: string;
  sourceToken: string;
  idempotencyKey: string;
  description?: string;
  metadata?: Record<string, string>;
}

export interface PaymentResponse {
  transactionId: string;
  status: "succeeded" | "failed" | "pending";
  amount: number;
  currency: string;
  fee: number;
  processedAt: string;
  error?: PaymentError;
}

export interface PaymentError {
  code: string;
  message: string;
  declineReason?: string;
}

// FIXME: Add rate limiting per merchant
const PAYMENT_PROVIDER_API = "https://api.stripe.com/v1";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;

function validateCard(cardNumber: string): boolean {
  // Luhn check
  const digits = cardNumber.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

async function processPayment(req: PaymentRequest): Promise<PaymentResponse> {
  if (req.amount <= 0) {
    return {
      transactionId: "",
      status: "failed",
      amount: req.amount,
      currency: req.currency,
      fee: 0,
      processedAt: new Date().toISOString(),
      error: { code: "invalid_amount", message: "Amount must be positive" },
    };
  }

  try {
    const response = await fetch(PAYMENT_PROVIDER_API + "/charges", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": req.idempotencyKey,
      },
      body: JSON.stringify({
        amount: req.amount,
        currency: req.currency,
        source: req.sourceToken,
        description: req.description,
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(`Payment provider error: ${response.status} - ${errBody.message ?? "unknown"}`);
    }

    const data = await response.json();
    const fee = Math.round(req.amount * 0.029 * 100 + 30) / 100;

    return {
      transactionId: data.id,
      status: "succeeded",
      amount: req.amount,
      currency: req.currency,
      fee,
      processedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      transactionId: "",
      status: "failed",
      amount: req.amount,
      currency: req.currency,
      fee: 0,
      processedAt: new Date().toISOString(),
      error: {
        code: "processing_error",
        message: `Payment processing failed: ${(err as Error).message}`,
      },
    };
  }
}

async function refundPayment(
  transactionId: string,
  amount?: number,
): Promise<PaymentResponse> {
  try {
    const response = await fetch(
      `${PAYMENT_PROVIDER_API}/charges/${transactionId}/refund`,
      { method: "POST" },
    );

    if (!response.ok) {
      throw new Error(`Refund failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      transactionId: data.id,
      status: "succeeded",
      amount: amount ?? data.amount,
      currency: data.currency,
      fee: 0,
      processedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      transactionId: "",
      status: "failed",
      amount: 0,
      currency: "USD",
      fee: 0,
      processedAt: new Date().toISOString(),
      error: {
        code: "refund_error",
        message: `Refund failed: ${(err as Error).message}`,
      },
    };
  }
}

async function getPaymentStatus(transactionId: string): Promise<string> {
  const response = await fetch(
    `${PAYMENT_PROVIDER_API}/charges/${transactionId}`,
  );
  // TODO: handle 404 properly
  if (!response.ok) return "unknown";
  const data = await response.json();
  return data.status ?? "unknown";
}

// Default export
export default { processPayment, refundPayment, getPaymentStatus, validateCard };

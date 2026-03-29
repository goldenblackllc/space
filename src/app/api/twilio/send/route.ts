import { NextRequest } from 'next/server';
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();

    if (!phone || typeof phone !== 'string') {
      return Response.json({ error: 'A valid phone number is required.' }, { status: 400 });
    }

    // Strip everything except digits
    let digits = phone.replace(/\D/g, '');
    // If 10 digits, assume US and prepend country code
    if (digits.length === 10) digits = '1' + digits;
    // If 11 digits starting with 1, that's fine (e.g. 15550001234)
    const formattedPhone = `+${digits}`;

    const verification = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verifications.create({ to: formattedPhone, channel: 'sms' });

    return Response.json({ success: true, status: verification.status });
  } catch (err: unknown) {
    console.error('[twilio/send]', err);
    const message = err instanceof Error ? err.message : 'Failed to send OTP';
    return Response.json({ error: message }, { status: 500 });
  }
}

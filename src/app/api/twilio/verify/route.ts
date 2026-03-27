import { NextRequest } from 'next/server';
import twilio from 'twilio';
import { adminAuth } from '@/lib/firebase-admin';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function POST(req: NextRequest) {
  try {
    const { phone, code } = await req.json();

    if (!phone || !code) {
      return Response.json({ error: 'Phone and code are required.' }, { status: 400 });
    }

    let digits = phone.replace(/\D/g, '');
    if (digits.length === 10) digits = '1' + digits;
    const formattedPhone = `+${digits}`;

    // Verify the OTP via Twilio
    const check = await client.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID!)
      .verificationChecks.create({ to: formattedPhone, code });

    if (check.status !== 'approved') {
      return Response.json({ error: 'Invalid or expired code.' }, { status: 401 });
    }

    // Use phone number as stable Firebase UID (stripped of non-digits)
    const uid = `phone_${digits}`;

    // Ensure the user exists in Firebase Auth (upsert pattern)
    try {
      await adminAuth.getUser(uid);
    } catch {
      await adminAuth.createUser({ uid, phoneNumber: formattedPhone });
    }

    // Mint a custom token for the client to sign in with
    const customToken = await adminAuth.createCustomToken(uid);

    return Response.json({ success: true, customToken });
  } catch (err: unknown) {
    console.error('[twilio/verify]', err);
    const message = err instanceof Error ? err.message : 'Verification failed';
    return Response.json({ error: message }, { status: 500 });
  }
}

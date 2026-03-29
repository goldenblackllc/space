'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './login.module.css';

type Step = 'phone' | 'otp';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/twilio/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send code');
      setStep('otp');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error sending code');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/twilio/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');
      await signInWithCustomToken(auth, data.customToken);
      router.replace('/lobby');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.main}>
      {/* CRT scanline overlay */}
      <div className={styles.crt} aria-hidden="true" />

      {/* Starfield */}
      <div className={styles.stars} aria-hidden="true">
        {Array.from({ length: 80 }).map((_, i) => (
          <span
            key={i}
            className={styles.star}
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 4}s`,
              width: `${Math.random() < 0.3 ? 2 : 1}px`,
              height: `${Math.random() < 0.3 ? 2 : 1}px`,
            }}
          />
        ))}
      </div>

      <div className={styles.panel}>
        {/* Giant title */}
        <h1 className={styles.title}>S P A C E</h1>

        <p className={styles.subtitle}>
          {step === 'phone'
            ? '> ENTER COMMANDER CREDENTIALS'
            : `> ACCESS KEY TRANSMITTED TO ${phone}`}
        </p>

        <AnimatePresence mode="wait">
          {step === 'phone' ? (
            <motion.form
              key="phone-form"
              className={styles.form}
              onSubmit={handleSendOtp}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className={styles.fieldGroup}>
                <label htmlFor="phone-input" className={styles.label}>COMMANDER ID</label>
                <input
                  id="phone-input"
                  className={styles.input}
                  type="tel"
                  placeholder="+1 555 000 0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  autoFocus
                  autoComplete="tel"
                />
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <button
                id="send-code-btn"
                type="submit"
                className={styles.arcadeBtn}
                disabled={loading || phone.length < 7}
              >
                {loading ? 'TRANSMITTING...' : 'AUTHENTICATE'}
              </button>
            </motion.form>
          ) : (
            <motion.form
              key="otp-form"
              className={styles.form}
              onSubmit={handleVerifyOtp}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className={styles.fieldGroup}>
                <label htmlFor="otp-input" className={styles.label}>ACCESS KEY</label>
                <input
                  id="otp-input"
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="000000"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              {error && <p className={styles.error}>{error}</p>}

              <button
                id="verify-btn"
                type="submit"
                className={styles.arcadeBtn}
                disabled={loading || otp.length !== 6}
              >
                {loading ? 'VERIFYING...' : 'LAUNCH'}
              </button>

              <button
                type="button"
                className={styles.ghostBtn}
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
              >
                [&lt;] CHANGE ID
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        <p className={styles.hint}>FORGOT KEY? RE-AUTHENTICATE ABOVE.</p>
      </div>
    </main>
  );
}

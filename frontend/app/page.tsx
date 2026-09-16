'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth-token';
import { googleSignInUrl } from '@/lib/api';
import { useClientOnlyValue } from '@/lib/use-client-only-value';
import { Blocks, KeyRound, LineChart, type LucideIcon } from 'lucide-react';

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: KeyRound,
    title: 'API keys',
    description:
      'Generate a key and drop it into your app, and it can call everything Neuron exposes.',
  },
  {
    icon: Blocks,
    title: 'Shared services',
    description:
      'A URL shortener and email notifications today, with more services shipping behind the same key.',
  },
  {
    icon: LineChart,
    title: 'Usage tracking',
    description:
      'Every authenticated call is logged automatically, so you can see what is calling what.',
  },
];

export default function Home() {
  const router = useRouter();
  const token = useClientOnlyValue<string | null>(getToken, null);

  useEffect(() => {
    if (token) router.replace('/dashboard');
  }, [token, router]);

  if (token) return null;

  return (
    <div className="flex flex-1 flex-col bg-canvas">
      <header className="px-5 py-6 sm:px-10">
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent font-display text-sm font-bold text-white">
            N
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-fg">
            Neuron
          </span>
        </span>
      </header>

      <main className="flex flex-1 flex-col items-center px-5 pt-10 pb-20 sm:pt-16">
        <div className="flex w-full max-w-lg flex-col items-center text-center">
          <h1 className="font-display text-[32px] font-semibold tracking-tight text-fg sm:text-[40px]">
            One key. Every shared service.
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-fg-2">
            Neuron is the shared backend for the apps you build: short
            links, email notifications, and whatever ships next, all
            reachable behind a single API key, with every call logged
            automatically.
          </p>
          <a
            href={googleSignInUrl()}
            className="mt-8 flex w-full max-w-xs items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(16,24,40,0.15)] hover:bg-accent-hover"
          >
            Sign in with Google
          </a>
        </div>

        <div className="mt-20 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 text-left"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <feature.icon className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-fg">
                  {feature.title}
                </h2>
                <p className="mt-1 text-sm text-fg-2">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

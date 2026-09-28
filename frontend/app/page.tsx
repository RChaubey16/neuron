'use client';

import { useEffect } from 'react';
import Image from 'next/image';
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
    <div className="flex flex-1 flex-col bg-canvas lg:grid lg:grid-cols-2">
      {/* Below lg the image becomes a short banner above the content; from lg
          up it's the right half, pinned to the viewport while the left scrolls. */}
      <div className="relative h-44 w-full overflow-hidden sm:h-60 lg:sticky lg:top-0 lg:order-2 lg:h-screen">
        <Image
          src="/images/login-image.jpg"
          alt=""
          fill
          preload
          sizes="(min-width: 1024px) 50vw, 100vw"
          className="object-cover"
        />
      </div>

      <div className="flex flex-1 flex-col lg:order-1 lg:min-h-screen">
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

        <main className="flex flex-1 flex-col px-5 pt-6 pb-16 sm:px-10 sm:pt-10 lg:justify-center lg:pt-0">
          <div className="mx-auto w-full max-w-md">
            <h1 className="font-display text-[32px] font-semibold tracking-tight text-fg sm:text-[40px]">
              One key. Every shared service.
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-fg-2">
              Neuron is the shared backend for the apps you build: short links,
              email notifications, and whatever ships next, all reachable behind
              a single API key, with every call logged automatically.
            </p>
            <a
              href={googleSignInUrl()}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-white shadow-[inset_0_-1px_0_rgba(16,24,40,0.15)] hover:bg-accent-hover sm:w-auto sm:inline-flex"
            >
              Sign in with Google
            </a>

            <ul className="mt-12 flex flex-col gap-5 border-t border-border pt-8">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <feature.icon className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-fg">
                      {feature.title}
                    </h2>
                    <p className="mt-1 text-sm text-fg-2">
                      {feature.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </main>
      </div>
    </div>
  );
}

'use client';

type MonetagResult = { reward_event_type?: 'valued' | 'non_valued'; variable2?: string } | undefined;

declare global {
  interface Window {
    show_12295910?: (options?: { type?: 'end' | 'start' | 'preload' | 'pop' | 'inApp'; ymid?: string; requestVar?: string; inAppSettings?: { frequency: number; capping: number; interval: number; timeout: number; everyPage?: boolean } }) => Promise<MonetagResult>;
  }
}

type RewardResponse = { ok?: boolean; reward?: number; wallet?: { coins?: number }; error?: string };

export async function claimMonetagActionReward(args: {
  initData: string;
  ymid: string;
  purpose: 'sell_action' | 'mining_start' | 'automatic_in_app';
}): Promise<{ reward: number; walletCoins: number }> {
  const delays = [0, 700, 1200, 1800, 2500, 3500, 5000, 7000, 9000];
  let lastError = 'monetag_postback_not_verified';
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    const response = await fetch('/api/ads/action-reward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': args.initData },
      body: JSON.stringify({ ymid: args.ymid, purpose: args.purpose }),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({})) as RewardResponse;
    if (response.ok && data.ok === true && Number.isSafeInteger(data.reward) && Number.isSafeInteger(data.wallet?.coins)) {
      return { reward: Number(data.reward), walletCoins: Number(data.wallet?.coins) };
    }
    lastError = data.error || lastError;
    if (response.status !== 409 || lastError !== 'monetag_postback_not_verified') throw new Error(lastError);
  }
  throw new Error(lastError);
}

export async function watchMonetagRewardedAd(args: {
  initData: string;
  requestVar: string;
  endpoint: '/api/ads/reward' | '/api/ads/action-reward' | '/api/lucky-wheel';
  body: (ymid: string) => Record<string, unknown>;
}): Promise<{ reward: number; walletCoins: number }> {
  if (typeof window === 'undefined' || typeof window.show_12295910 !== 'function') throw new Error('monetag_sdk_unavailable');
  if (!args.initData) throw new Error('telegram_auth_required');
  const ymid = crypto.randomUUID();
  window.dispatchEvent(new Event('armco:monetag-ad-start'));
  const result = await window.show_12295910({ ymid, requestVar: args.requestVar });
  if (result?.reward_event_type === 'non_valued' || (result?.variable2 && result.variable2 !== ymid)) throw new Error('monetag_ad_not_valued');
  if (args.endpoint === '/api/ads/action-reward') {
    const body = args.body(ymid);
    const purpose = body.purpose;
    if (purpose !== 'sell_action' && purpose !== 'mining_start' && purpose !== 'automatic_in_app') throw new Error('invalid_ad_purpose');
    return claimMonetagActionReward({ initData: args.initData, ymid, purpose });
  }
  const delays = [0, 700, 1200, 1800, 2500, 3500, 5000, 7000, 9000];
  let lastError = 'monetag_postback_not_verified';
  for (const delay of delays) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    const response = await fetch(args.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': args.initData },
      body: JSON.stringify(args.body(ymid)),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({})) as RewardResponse;
    if (response.ok && data.ok === true && Number.isSafeInteger(data.reward) && Number.isSafeInteger(data.wallet?.coins)) {
      return { reward: Number(data.reward), walletCoins: Number(data.wallet?.coins) };
    }
    lastError = data.error || lastError;
    if (response.status !== 409 || lastError !== 'monetag_postback_not_verified') throw new Error(lastError);
  }
  throw new Error(lastError);
}

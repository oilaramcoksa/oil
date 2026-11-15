'use client';

/**
 * Optional non-rewarded ad gate.
 *
 * Adsgram block int-59643 is currently inactive. Do not initialize the SDK
 * until the publisher activates a valid block: the SDK can display its own
 * blocking AdsgramError dialog before a rejected promise reaches our catch.
 *
 * Keep this function as a no-op so every gameplay, sale, swap and withdrawal
 * flow continues immediately. Re-enable the ad only after the block is active
 * and verified in the publisher dashboard.
 */
export async function showActionInterstitial(): Promise<void> {
  // Fail open by design: advertising must never block a player action.
  return;
}

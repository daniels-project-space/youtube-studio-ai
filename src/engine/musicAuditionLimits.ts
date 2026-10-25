// Eight provider tracks, each bounded to ten minutes; native Music3 remains
// separately constrained by its pinned worker receipt and 300-second contract.
export const MUSIC_PROVIDER_MIX_MAX_SECONDS = 8 * 600;
export const MUSIC_PROVIDER_AUDITION_MAX_BYTES = MUSIC_PROVIDER_MIX_MAX_SECONDS * 32_000 * 2 * 2 + 1_048_576;

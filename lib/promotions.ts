export const MAX_PROMOTIONS = 8;
export const PROMOTION_INTERVAL_MS = 6000;
export const PROMOTION_WIDTH = 1500;
export const PROMOTION_HEIGHT = 500;
export const PROMOTION_MAX_BYTES = 5 * 1024 * 1024;

export interface Promotion {
  id: string;
  title: string;
  imageUrl: string;
  enabled: boolean;
}
export interface PromotionSettings {
  revision: number;
  banners: Promotion[];
}

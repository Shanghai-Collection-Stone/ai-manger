import { useRef } from 'react';

/**
 * @description Hook to detect swipe gestures
 * @keyword-en useSwipe
 * @param {Object} options
 * @param {Function} [options.onSwipeLeft]
 * @param {Function} [options.onSwipeRight]
 * @param {number} [options.threshold=50]
 */
export const useSwipe = ({ onSwipeLeft, onSwipeRight, threshold = 50 }) => {
  const touchStart = useRef(null);
  const touchEnd = useRef(null);

  const minSwipeDistance = threshold;

  const onTouchStart = (e) => {
    touchEnd.current = null;
    touchStart.current = { x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY };
  };

  const onTouchMove = (e) => {
    touchEnd.current = { x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY };
  };

  const onTouchEnd = (e) => {
    if (!touchStart.current || !touchEnd.current) return;
    
    const distanceX = touchStart.current.x - touchEnd.current.x;
    const distanceY = touchStart.current.y - touchEnd.current.y;
    const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY);

    if (isHorizontalSwipe) {
      if (Math.abs(distanceX) < minSwipeDistance) return;

      if (distanceX > 0 && onSwipeLeft) {
        onSwipeLeft();
        // Stop propagation to prevent parent handlers from firing
        if (e && e.stopPropagation) e.stopPropagation();
      } else if (distanceX < 0 && onSwipeRight) {
        onSwipeRight();
        // Stop propagation to prevent parent handlers from firing
        if (e && e.stopPropagation) e.stopPropagation();
      }
    }
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd
  };
};

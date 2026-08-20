import type { Action } from 'svelte/action'
import { prefersReducedMotion } from './motion'

/**
 * Cycle text that does not fit (v28.2): when the element's content overflows
 * its box, glide slowly to the far end, hold, and glide back, forever — stare
 * at the deck label for a moment and the whole title passes by.
 *
 * The action only measures and flags; the movement itself is a CSS keyframe
 * on the inner span, driven by the two custom properties set here. Distance-
 * proportional duration, so a slightly-too-long title drifts gently and a very
 * long one is not comically slow. Under prefers-reduced-motion the class is
 * simply never added and the plain ellipsis stays.
 */
export const marquee: Action<HTMLElement, string | null> = (node, text) => {
  let frame = 0

  const measure = () => {
    const overflow = node.scrollWidth - node.clientWidth
    if (overflow > 1 && !prefersReducedMotion()) {
      node.style.setProperty('--marquee-shift', `${-overflow}px`)
      node.style.setProperty('--marquee-duration', `${(overflow / 15 + 4).toFixed(2)}s`)
      node.classList.add('overflowing')
    } else {
      node.classList.remove('overflowing')
    }
  }

  // After layout: scrollWidth is 0 while fonts and the grid still settle.
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
  }

  const observer = new ResizeObserver(schedule)
  observer.observe(node)
  schedule()
  void text

  return {
    update() {
      schedule()
    },
    destroy() {
      cancelAnimationFrame(frame)
      observer.disconnect()
    },
  }
}

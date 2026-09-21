import { useEffect, useRef, ReactNode, ElementType } from 'react';

/**
 * Scroll-reveal.
 *
 * One IntersectionObserver per element, disconnected the moment it fires, so a
 * long page costs nothing once scrolled. Only opacity and transform animate, so
 * it stays on the compositor. No library.
 *
 * The element starts hidden ONLY when the browser supports the observer and the
 * viewer has not asked for reduced motion — otherwise it renders visible, so
 * content can never be trapped behind an animation that never runs.
 */
export function Reveal({
  as: Tag = 'div',
  delay = 0,
  y = 14,
  className = '',
  children,
  ...rest
}: {
  as?: ElementType;
  delay?: number;
  y?: number;
  className?: string;
  children: ReactNode;
  [key: string]: any;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-revealed');
      return;
    }

    el.classList.add('will-reveal');

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).style.transitionDelay = `${delay}ms`;
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -6% 0px' }
    );

    io.observe(el);
    return () => io.disconnect();
  }, [delay]);

  return (
    <Tag ref={ref} className={className} style={{ '--reveal-y': `${y}px` } as any} {...rest}>
      {children}
    </Tag>
  );
}

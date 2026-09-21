import { useState } from 'react';
import { CarArt, type CarVariant } from './CarArt';

/**
 * The one place that decides what a vehicle looks like across the site.
 *
 * Every fleet card, comparison row and trip summary renders through here, so
 * the look of the fleet is a change to this file rather than to thirteen call
 * sites.
 *
 * TWO STATES, AND WHICH ONE A VEHICLE GETS
 *
 * A photograph, if the office has supplied one OF THAT VEHICLE — the two sedans
 * today. Otherwise the studio drawing: rear three-quarter, blue backdrop, the
 * vehicle's name on its number plate, identical framing for every class (see
 * components/CarArt.tsx).
 *
 * The switch is simply whether `photo` is set in siteData, which is what makes
 * the mixed grid defensible rather than untidy. A stock press shot of a model
 * we do not own promises a car we cannot send and puts someone else's
 * copyright on a customer-facing page; the drawing promises the class, which is
 * exactly what the business promises. So a photo appears when it is ours, and
 * the drawing stands in everywhere else — never a stock photo of the model.
 *
 * A photo that fails to load falls back to the drawing rather than to a broken
 * image icon, so a mistyped filename degrades quietly.
 */
export function VehiclePhoto({
  photo,
  art,
  name,
  alt,
  className = '',
}: {
  /** Path to our photograph of this vehicle, or '' to draw it. */
  photo: string;
  art: CarVariant;
  /** Goes on the number plate of the drawing. */
  name?: string;
  alt: string;
  /** The drawing fills its frame edge to edge exactly as the photograph does,
   *  so both states take the same classes. */
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!photo || failed) return <CarArt variant={art} name={name} className={className} />;

  return (
    <img
      src={photo}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

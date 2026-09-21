/**
 * Customer reviews.
 *
 * WHY THIS SHIPS EMPTY
 * We do not hold verified customer reviews yet, and inventing testimonials for
 * a real business's website is not a design decision — it is a claim a customer
 * would act on. So `REVIEWS` is empty, the reviews page renders its designed
 * empty state, and the home page hides its reviews section entirely until there
 * is something real to put in it.
 *
 * HOW TO FILL IT
 * Add one entry per real review, with the reviewer's consent. Every field is
 * required except `vehicle`. The filters, the average and the layout all work
 * from a single entry upwards — there is no minimum.
 *
 * PREVIEWING THE LAYOUT
 * Open /reviews?preview=1 to see the cards filled with obviously-marked
 * placeholder text. That URL is for checking the design; a visitor arriving
 * normally never sees it.
 */

export type ReviewKind = 'Local' | 'Outstation' | 'Corporate' | 'Events';

export interface Review {
  id: string;
  name: string;
  /** Where they are from, or the company. Kept short. */
  from: string;
  rating: number;
  kind: ReviewKind;
  vehicle?: string;
  body: string;
  /** ISO date the review was given. */
  at: string;
}

/** Real reviews go here. See the note above. */
export const REVIEWS: Review[] = [];

/** Placeholder content, shown only on /reviews?preview=1. */
export const REVIEW_PREVIEW: Review[] = [
  {
    id: 'p1', name: 'Placeholder name', from: 'Placeholder area', rating: 5, kind: 'Outstation',
    vehicle: 'Toyota Innova Crysta', at: '2026-01-01',
    body: 'Placeholder text so the layout can be checked. A real review would sit here, at about this length — long enough to say what the trip was and what went well, short enough to read in one go.',
  },
  {
    id: 'p2', name: 'Placeholder name', from: 'Placeholder company', rating: 5, kind: 'Corporate',
    vehicle: 'Honda City', at: '2026-01-01',
    body: 'Placeholder text for a corporate review. Two or three sentences about billing, punctuality or the chauffeur is the useful shape.',
  },
  {
    id: 'p3', name: 'Placeholder name', from: 'Placeholder area', rating: 4, kind: 'Local',
    vehicle: 'Dzire', at: '2026-01-01',
    body: 'Placeholder text. A four-star review is worth publishing too — a page of nothing but five stars reads as unedited.',
  },
];

export const REVIEW_KINDS: ReviewKind[] = ['Local', 'Outstation', 'Corporate', 'Events'];

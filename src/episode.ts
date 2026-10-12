import type { Episode, EpisodeRequirement } from './types.js';

/** Read author-declared data without inserting defaults or authorizing a skip. */
export function getEpisodeRequirement(episode: Pick<Episode, 'requirement'>): EpisodeRequirement {
  const requirement = episode.requirement;
  if (requirement === undefined) return 'required';
  if (requirement === 'required' || requirement === 'optional') return requirement;
  throw new TypeError('Invalid episode requirement.');
}

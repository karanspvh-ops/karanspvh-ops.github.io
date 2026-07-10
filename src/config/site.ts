export const SITE = {
  name: 'SPVH Group',
  title: 'SPVH Group | Diversified Business & Financial Services Company',
  description:
    'SPVH Group is a diversified business and financial services company with focused verticals in wealth management, alternative investments, real estate, hospitality, automotive, media, and technology.',
  url:
    (typeof process !== 'undefined' && process.env.SITE_URL) ||
    'https://spvhgroup.com/',
  twitterHandle: '@spvhgroup',
  socials: {
    twitter: 'https://twitter.com/spvhgroup',
    github: '',
    linkedin: 'https://www.linkedin.com/company/spvhgroup',
  },
} as const;

export type SiteConfig = typeof SITE;

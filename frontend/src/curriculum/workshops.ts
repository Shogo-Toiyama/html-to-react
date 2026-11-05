// The workshop series as data. The side panel shows these; each step's
// instructions live in StepContent.tsx. To add a workshop, add an entry here
// and its steps' content there.

export type StepNeeds =
  /** Nothing to open yet (e.g. installing tools). */
  | 'nothing'
  /** An HTML website to convert, or a React project that was already converted. */
  | 'site'
  /** A React project (for example the converted "<site> - React" folder). */
  | 'react-project'

export interface Step {
  id: string
  title: string
  /** One line shown under the title. */
  goal: string
  needs: StepNeeds
}

export interface Workshop {
  id: string
  number: number
  title: string
  status: 'available' | 'coming-soon'
  /** Link to the workshop's slides. */
  slidesUrl?: string
  /** Number shown for the first step (0 when it starts with a setup step). */
  firstStepNumber: number
  steps: Step[]
}

export const WORKSHOPS: Workshop[] = [
  {
    id: 'w4',
    number: 4,
    title: 'Cleaner and Smarter with React',
    status: 'available',
    slidesUrl: 'https://www.figma.com/deck/InrFC9ZmS7rGC0UZhWZNMn',
    firstStepNumber: 0,
    steps: [
      {
        id: 'setup',
        title: 'Setup',
        goal: 'Get the slides and the code editor ready.',
        needs: 'nothing',
      },
      {
        id: 'jsx',
        title: 'JSX',
        goal: 'Turn your website into React and see what JSX looks like: HTML inside JavaScript.',
        needs: 'site',
      },
      {
        id: 'components',
        title: 'Components',
        goal: 'Split your page into reusable pieces, like your own HTML tags.',
        needs: 'react-project',
      },
      {
        id: 'props',
        title: 'Props',
        goal: 'Pass data into a component so one blueprint can show different content.',
        needs: 'react-project',
      },
      {
        id: 'tailwind',
        title: 'Tailwind CSS',
        goal: 'Style your components with classes right inside the JSX.',
        needs: 'react-project',
      },
      {
        id: 'chat',
        title: 'Build with AI',
        goal: 'Ask AI to add features to your site, then read how it did it.',
        needs: 'react-project',
      },
    ],
  },
  {
    id: 'w5',
    number: 5,
    title: 'Advanced React',
    status: 'coming-soon',
    firstStepNumber: 1,
    steps: [],
  },
]

export const DEFAULT_POSITION = { workshop: 'w4', step: 'setup' }

export function findWorkshop(id: string): Workshop | undefined {
  return WORKSHOPS.find((workshop) => workshop.id === id && workshop.status === 'available')
}

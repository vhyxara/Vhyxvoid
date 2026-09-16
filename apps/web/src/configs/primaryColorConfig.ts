export type PrimaryColorConfig = {
  name?: string
  light?: string
  main: string
  dark?: string
}

// Primary color config object
const primaryColorConfig: PrimaryColorConfig[] = [
  {
    name: 'primary-1',
    light: '#7C3AED',
    main: '#A855F7',
    dark: '#6D28D9'
  },
  {
    name: 'primary-2',
    light: '#A855F7',
    main: '#7C3AED',
    dark: '#6D28D9'
  }

  // {
  //   name: 'primary-3',
  //   light: '#FFC25A',
  //   main: '#FFAB1D',
  //   dark: '#BA7D15'
  // },
  // {
  //   name: 'primary-4',
  //   light: '#F0718D',
  //   main: '#EB3D63',
  //   dark: '#AC2D48'
  // },
  // {
  //   name: 'primary-5',
  //   light: '#5CAFF1',
  //   main: '#2092EC',
  //   dark: '#176BAC'
  // }
]

export default primaryColorConfig

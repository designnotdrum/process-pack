// The fixture's Storybook: one config at the root that loads every story under the two folders Klaus reads.
const config = {
  stories: ['../packages/**/*.stories.@(ts|tsx)', '../apps/**/*.stories.@(ts|tsx)'],
  framework: '@storybook/react',
}

export default config

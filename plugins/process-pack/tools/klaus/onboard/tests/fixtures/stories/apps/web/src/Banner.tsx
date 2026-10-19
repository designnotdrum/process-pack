export interface BannerProps {
  title: string
}

export function Banner({ title }: BannerProps) {
  return <h2>{title}</h2>
}

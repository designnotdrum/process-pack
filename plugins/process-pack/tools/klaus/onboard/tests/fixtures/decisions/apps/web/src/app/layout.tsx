import { AppProvider } from '@/components/AppProvider'
import { ThemeProvider } from '@/components/ThemeProvider'

export default function RootLayout({ children }: { children: JSX.Element }) {
  return (
    <ThemeProvider>
      <AppProvider>{children}</AppProvider>
    </ThemeProvider>
  )
}

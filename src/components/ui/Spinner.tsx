import { memo } from 'react'
import { Loader2 } from 'lucide-react'

type SpinnerProps = {
  size?: number
  className?: string
}

const Spinner = memo(function Spinner({ size = 14, className }: SpinnerProps) {
  return <Loader2 className={`animate-spin ${className ?? ''}`} size={size} aria-hidden="true" />
})

Spinner.displayName = 'Spinner'

export default Spinner

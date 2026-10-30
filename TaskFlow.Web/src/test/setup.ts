import '@testing-library/jest-dom'
import { configureApiClient } from '@/api/configure-client'

// Real-client tests need the same runtime flag as the app (set in main.tsx).
configureApiClient()

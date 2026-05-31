import { Router } from "express"

// Cognito 인증 환경에서는 익명 사용자 병합이 사용되지 않습니다.
export const authRouter = Router()

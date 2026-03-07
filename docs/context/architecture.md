Project: NxtLegal

Architecture:

UI → Feature Logic → Repository → Database

API Routes are thin controllers.

Domain services contain business logic.

Infrastructure is injected via interfaces.

Authentication:
OAuth (Microsoft AD) + JWT

Access Token: 2 days
Refresh Token: 7 days
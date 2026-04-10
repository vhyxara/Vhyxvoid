# Black Server

┌────────────────────────────────────────────────────────────-─┐
│                         HUB PROCESS                          │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────-─┐  │
│  │ WS Server    │    │ AgentRegistry│    │ PendingRegistry│  │
│  │ (port 3001)  │───▶│ accountId →  │    │ requestId →    │  │
│  │              │    │  label →     │    │  { resolve,    │  │
│  └──────────────┘    │  AgentSession│    │    reject,     │  │
│          │           └──────────────┘    │    timeout }   │  │
│          │                  │            └───────────────-┘  │
│          ▼                  ▼                    │           │
│  ┌──────────────┐    ┌──────────────┐           │            │
│  │ MessageRouter│    │ HeartbeatSvc │    ┌───────────────┐   │
│  │              │    │ (10s loop)   │    │ Redis Backing │   │
│  └──────────────┘    └──────────────┘    │ hub:pending:* │   │
│          │                               └───────────────┘   │
│          ▼                                                   │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │ HubAuthSvc   │    │ HubUsageSvc  │    │ RedisPubSub   │   │
│  │ (calls       │    │ (calls       │    │ (cross-hub    │   │
│  │  ValidateKey │    │  incr usage) │    │  routing stub)│   │
│  │  UseCase)    │    │              │    │               │   │
│  └──────────────┘    └──────────────┘    └───────────────┘   │
└─────────────────────────────────────────────────────────────-┘
         ↑ shared code import (no HTTP)
         │
┌─────────────────┐
│ packages/shared │
│ - PrismaClient  │
│ - RedisClient   │
│ - ValidateKey   │
│   UseCase       │
└─────────────────┘
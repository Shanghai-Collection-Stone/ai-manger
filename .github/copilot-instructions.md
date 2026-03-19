# Copilot Instructions for AI-MVP

## Project Overview

**AI-MVP** is a full-stack AI agent platform with a NestJS backend and Astro frontend. The application integrates LangChain-based AI agents with MongoDB for persistence and real-time communication streams.

### Tech Stack
- **Backend**: NestJS 11, TypeScript (ES2022), Node.js
- **Frontend**: Astro, Tailwind CSS
- **AI/ML**: LangChain (v1.2), Anthropic, Google GenAI, OpenAI
- **Database**: MongoDB with migrate-mongo
- **Containers**: Docker Compose
- **Package Manager**: pnpm
- **Code Quality**: ESLint + Prettier, Jest

### Key Packages
- `@langchain/*`: Core AI agent framework
- `@langchain/langgraph`: Agent workflow orchestration
- `deepagents`: Custom agent framework
- `@larksuiteoapi/node-sdk`: Feishu integration
- `jimp`: Image processing
- `zod`: Schema validation

---

## Build & Development Commands

### Backend (NestJS)
```bash
# Start development server (watch mode)
pnpm run start:dev

# Build for production
pnpm run build

# Start production server
pnpm run start:prod

# Debug mode
pnpm run start:debug
```

### Linting & Formatting
```bash
# Fix ESLint issues (auto-fixes TypeScript syntax)
pnpm run lint

# Format code with Prettier
pnpm run format
```

### Testing
```bash
# Run unit tests (Jest)
pnpm run test

# Watch mode for tests
pnpm run test:watch

# Coverage report
pnpm run test:cov

# E2E tests
pnpm run test:e2e

# Debug tests
pnpm run test:debug
```

### Database
```bash
# Run pending migrations
pnpm run migration:up

# Rollback last migration
pnpm run migration:down

# Check migration status
pnpm run migration:status

# Create new migration
pnpm run migration:create <name>
```

### Other Commands
```bash
# Compress local images
pnpm run compress:local-image

# Docker Compose (backend services)
docker-compose -f server/docker-compose.yml up -d
```

---

## Project Architecture

### Directory Structure
- `src/modules/` - NestJS modules for each domain
  - `ai-agent/` - Core agent orchestration
  - `ai-context/` - Context management for AI
  - `chat-main/` - Chat message handling
  - `dashboard/` - Dashboard APIs
  - `data-source/` - External data source integrations
  - `checkpoint/` - LangGraph checkpoint persistence
  - `mongo-query/` - MongoDB query abstractions
  - Other domain modules (admin, gallery, todo, etc.)

- `src/shared/` - Shared utilities and services
- `src/types/` - Global TypeScript types
- `src/scripts/` - Scheduled/utility scripts
- `web/` - Astro frontend
- `migrations/` - MongoDB migration files
- `config/` - Configuration files (MCP servers, dashboards)
- `test/` - E2E tests

### Module Pattern
Each NestJS module follows this structure:
```
module-name/
├── module-name.module.ts      # Module definition
├── services/                   # Business logic
├── controllers/                # HTTP endpoints (if needed)
├── types/                      # Type definitions
├── enums/                      # Enumerations
├── description/                # Module documentation
└── module.md                   # Design notes
```

### Path Aliases
The project uses TypeScript path aliases:
- `@/*` → `src/*` (root namespace)
- `@core/*` → `src/core/*` (core services)
- `@plugin/*` → `plugins/*` (plugin namespace)

---

## Key Conventions

### TypeScript Configuration
- **Strict Mode**: `strict: true` - all defaults enabled
- **Strict Null Checks**: Required - no implicit undefined
- **Unused Variables**: Enforced - must import only used dependencies
- **Casing**: `forceConsistentCasingInFileNames: false` - Windows compatibility
- **Decorators**: Enabled for NestJS (`emitDecoratorMetadata`, `experimentalDecorators`)

### Code Style
- **Formatter**: Prettier (configured in eslint)
- **Linter**: ESLint with TypeScript plugin
- **Relaxed Rules** (pragmatic for AI code):
  - `@typescript-eslint/no-unsafe-call`: OFF
  - `@typescript-eslint/no-explicit-any`: OFF
  - Tests have relaxed unsafe rules
- Always run `pnpm run lint` before committing

### Naming Conventions
- Files: kebab-case (`user.service.ts`, `auth.module.ts`)
- Directories: kebab-case (`src/modules/chat-main/`)
- Classes: PascalCase (`UserService`, `AuthController`)
- Variables/Functions: camelCase (`getUserId`, `createSession`)

### Import Order
1. Node.js built-ins
2. Third-party packages (@nestjs, @langchain, etc.)
3. Local absolute imports (@/...)
4. Relative imports (../)

---

## Common Patterns

### NestJS Module Definition
```typescript
import { Module, forwardRef } from '@nestjs/common';

@Module({
  imports: [forwardRef(() => OtherModule)],
  providers: [MyService],
  exports: [MyService],
})
export class MyModule {}
```

### Service Pattern
- Services are singletons providing business logic
- Use dependency injection via constructor parameters
- Avoid circular dependencies (use `forwardRef`)

### LangChain Agent Usage
- AI agents are created in dedicated service methods
- Use `@langchain/langgraph` for multi-step workflows
- Store checkpoints in MongoDB via `@langchain/langgraph-checkpoint-mongodb`
- Example: `src/modules/ai-agent/services/agent.service.ts`

### MongoDB Migrations
- Create new migrations with `pnpm run migration:create <name>`
- Format: `YYYYMMDDHHMMSS-description.js`
- Always test migrations before deployment with `migration:status`

---

## Important Configuration Files

### Environment Variables
- `.env` file (project root) - configure database, API keys, proxy settings
- Database: `MONGO_URI`, `MONGO_DB_NAME`
- LLM: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`
- Proxy: `HTTP_PROXY`, `HTTPS_PROXY` (auto-initialized by ai-agent module)

### MCP Servers
- Configuration: `config/mcp.servers.json`
- Defines Model Context Protocol servers for external integrations
- Used by LangChain for tool binding

### Docker
- `docker-compose.yml` (root) - full stack
- `server/docker-compose.yml` - backend only (MongoDB, services)

---

## Common Pitfalls & Solutions

### Circular Module Dependencies
**Problem**: Modules importing each other causes initialization errors.  
**Solution**: Use `forwardRef(() => ModuleName)` in `@Module()` imports.

### MongoDB Connection Timeouts
**Problem**: Can't connect to MongoDB during migrations or startup.  
**Solution**: Verify `MONGO_URI` in `.env`, ensure MongoDB container is running (`docker-compose up -d`).

### LangChain Proxy Issues
**Problem**: LLM API calls fail behind corporate proxy.  
**Solution**: Set `HTTP_PROXY` and `HTTPS_PROXY` environment variables. The `ai-agent.module` auto-initializes proxy settings.

### TypeScript Strict Mode Issues
**Problem**: Build fails with "property is possibly undefined" errors.  
**Solution**: Add explicit type annotations or use optional chaining (`?.`). Don't use `any` unless necessary - use `unknown` instead.

### Missing Type Definitions
**Problem**: Types missing for third-party packages.  
**Solution**: Install `@types/package-name` or configure `skipLibCheck: true` in tsconfig (already enabled).

### Import Path Issues
- Always use path aliases when available: `@/modules/chat-main` instead of `../../modules/chat-main`
- Verify path mappings in `tsconfig.json` before creating new absolute paths

---

## When Working on Specific Areas

### Backend API Development
1. Create module: `pnpm run nest generate m modules/my-feature`
2. Add controllers/services as needed
3. Register in module imports/exports
4. Add tests in `test/` directory
5. Run `pnpm run test:e2e` before submitting

### AI Agent Development
- Extend `ai-agent.module.ts` or create in `src/modules/ai-agent/services/`
- Use LangChain's `AgentExecutor` or `@langchain/langgraph` for workflows
- Reference example: `src/modules/ai-agent/services/agent.service.ts`
- Test with `test:e2e` for agent behavior validation

### Frontend/UI Development
1. Navigate to `web/` directory
2. Modify Astro pages in `web/src/pages/` and components in `web/src/ui/`
3. Tailwind styles are configured in `tailwind.config.mjs`
4. Build: `cd web && pnpm run build`

### Database Migrations
1. Create: `pnpm run migration:create my_migration_name`
2. Edit generated file in `migrations/`
3. Test locally: `pnpm run migration:status && pnpm run migration:up`
4. Document breaking changes in migration file comments

---

## Debugging

### Enable Debug Logging
```bash
# Start with debug output
pnpm run start:debug

# Or for tests
pnpm run test:debug
```

### Check Application Status
```bash
# View running containers
docker-compose ps

# Check MongoDB
docker exec -it mongodb mongosh

# View logs
docker-compose logs -f
```

### Common Debug Patterns
- Use `console.log()` for quick debugging (remember to remove before commit)
- Use `debugger;` and run with `pnpm run start:debug`
- Jest tests: Add `.only` to single test or `.skip` to exclude

---

## Performance & Scalability Notes

- **Streaming**: Chat responses use stream-based APIs (check `@langchain/core` adapters)
- **Checkpointing**: All AI agent state persists to MongoDB via LangGraph checkpoint adapters
- **Caching**: Implement caching layer for frequently accessed data sources
- **Image Processing**: Use `jimp` for on-the-fly image resizing; consider background job queue for bulk operations

---

## Resources & Documentation

- [NestJS Documentation](https://docs.nestjs.com)
- [LangChain Documentation](https://js.langchain.com)
- [Astro Documentation](https://docs.astro.build)
- [MongoDB Documentation](https://docs.mongodb.com)
- Local docs: Check `src/modules/*/module.md` for domain-specific documentation

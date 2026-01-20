import { Injectable } from '@nestjs/common';
import { CreateAgentParams } from 'langchain';
import { FrontendFunctionCallService } from '../../frontend/services/frontend.service.js';
import { AnalysisFunctionCallService } from '../../analysis/services/analysis.service.js';
import { MongoFunctionCallService } from '../../mongo/services/mongo.service.js';
import { SchemaFunctionCallService } from '../../schema/services/schema.service.js';
import { TitleFunctionCallService } from '../../title/services/title.service.js';

/**
 * @title 工具服务 Tools Service
 * @description 提供工具集合的Function-Call描述。
 * @keywords-cn 工具服务, 句柄
 * @keywords-en tools service, handle
 */
@Injectable()
export class ToolsService {
  constructor(
    private readonly frontend: FrontendFunctionCallService,
    private readonly analysis: AnalysisFunctionCallService,
    private readonly mongo: MongoFunctionCallService,
    private readonly schema: SchemaFunctionCallService,
    private readonly title: TitleFunctionCallService,
  ) {}

  getHandle(streamWriter?: (msg: string) => void): CreateAgentParams['tools'] {
    const tools: CreateAgentParams['tools'] = [];
    const tFrontend = this.frontend.getHandle() ?? [];
    const tAnalysis = this.analysis.getHandle(streamWriter) ?? [];
    const tMongo = this.mongo.getHandle() ?? [];
    const tSchema = this.schema.getHandle() ?? [];
    const tTitle = this.title.getHandle() ?? [];
    tools.push(...tFrontend, ...tAnalysis, ...tMongo, ...tSchema, ...tTitle);
    return tools;
  }
}

import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * @description 校验为节点保存提供商与模型的请求，模型留空时使用提供商自身默认模型。
 * @keyword-cn 保存节点模型参数, 提供商选择
 * @keyword-en save-node-model-dto, provider-selection
 */
export class SaveWorkflowNodeModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  providerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  model?: string;
}

/**
 * @description 校验查询提供商可选模型时的节点类型。
 * @keyword-cn 查询可选模型参数, 节点类型
 * @keyword-en list-provider-models-dto, node-category
 */
export class ListWorkflowProviderModelsDto {
  @IsIn(['llm', 'image', 'video'])
  category!: 'llm' | 'image' | 'video';
}

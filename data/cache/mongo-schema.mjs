export default {
  "tables": [
    {
      "name": "admin_ssh_permissions",
      "keywords": [
        "管理后台",
        "SSH权限",
        "权限管理",
        "访问控制",
        "安全"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的SSH权限记录"
        },
        {
          "name": "name",
          "type": "string",
          "description": "权限名称，用于在界面上展示"
        },
        {
          "name": "code",
          "type": "string",
          "description": "权限代码，用于程序中进行权限判断和控制"
        },
        {
          "name": "description",
          "type": "string",
          "description": "权限描述，详细说明该权限的功能和用途"
        },
        {
          "name": "type",
          "type": "string",
          "description": "权限类型，例如菜单权限、API权限等，用于区分不同类型的权限"
        },
        {
          "name": "status",
          "type": "number",
          "description": "权限状态，0表示禁用，1表示启用"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录权限创建的时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录权限最后一次更新的时间"
        },
        {
          "name": "menu_id",
          "type": "string",
          "description": "关联菜单ID，如果该权限与某个菜单相关联，则记录该菜单的ID"
        }
      ]
    },
    {
      "name": "group_activities",
      "keywords": [
        "团购",
        "活动",
        "促销",
        "优惠",
        "社交电商"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的团购活动"
        },
        {
          "name": "name",
          "type": "string",
          "description": "活动名称，用于在界面上展示"
        },
        {
          "name": "max_members",
          "type": "number",
          "description": "最大参与人数，限制参与团购活动的人数上限"
        },
        {
          "name": "start_time",
          "type": "date",
          "description": "开始时间，团购活动开始的时间"
        },
        {
          "name": "end_time",
          "type": "date",
          "description": "结束时间，团购活动结束的时间"
        },
        {
          "name": "fee",
          "type": "number",
          "description": "活动费用，参与团购活动需要支付的费用"
        },
        {
          "name": "status",
          "type": "number",
          "description": "活动状态，例如：待开始、进行中、已结束等"
        },
        {
          "name": "current_members",
          "type": "number",
          "description": "当前参与人数，已经参与团购活动的人数"
        },
        {
          "name": "cover_image",
          "type": "string",
          "description": "封面图片，用于在活动列表中展示"
        },
        {
          "name": "description",
          "type": "string",
          "description": "活动简介，对团购活动的简单描述"
        },
        {
          "name": "banners",
          "type": "array",
          "description": "横幅图片列表，用于在活动详情页展示"
        },
        {
          "name": "description_nodes",
          "type": "string",
          "description": "活动详情，富文本格式的活动详细描述"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录活动创建的时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录活动最后一次更新的时间"
        },
        {
          "name": "duration",
          "type": "number",
          "description": "持续时间，团购活动持续的时间，单位为秒"
        },
        {
          "name": "min_members",
          "type": "string",
          "description": "最小成团人数，达到此人数才能成团"
        },
        {
          "name": "type_id",
          "type": "number",
          "description": "活动类型ID，关联活动类型表"
        },
        {
          "name": "show",
          "type": "string",
          "description": "是否显示，用于控制活动是否在前台展示"
        }
      ]
    },
    {
      "name": "admin_ssh_goods_displays",
      "keywords": [
        "管理后台",
        "商品展示",
        "商品管理",
        "展示配置"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的商品展示配置"
        },
        {
          "name": "name",
          "type": "string",
          "description": "展示名称，用于在管理界面上标识该展示配置"
        },
        {
          "name": "description",
          "type": "string",
          "description": "展示描述，详细说明该展示配置的用途和内容"
        },
        {
          "name": "sort_order",
          "type": "number",
          "description": "排序，用于控制商品展示的顺序，数值越小越靠前"
        },
        {
          "name": "status",
          "type": "number",
          "description": "状态，0表示禁用，1表示启用，用于控制该展示配置是否生效"
        },
        {
          "name": "code",
          "type": "string",
          "description": "代码标识，用于程序中进行调用和判断"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该展示配置的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该展示配置最后一次更新的时间"
        }
      ]
    },
    {
      "name": "shop",
      "keywords": [
        "店铺",
        "商店",
        "商家"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的店铺"
        },
        {
          "name": "name",
          "type": "string",
          "description": "店铺名称，用于在界面上展示"
        },
        {
          "name": "url",
          "type": "string",
          "description": "店铺URL，店铺的网址链接"
        }
      ]
    },
    {
      "name": "compass",
      "keywords": [
        "罗盘",
        "用户行为",
        "指标",
        "数据统计"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "object",
          "description": "唯一标识符，用于区分不同的罗盘数据记录"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，关联用户表，记录该罗盘数据属于哪个用户"
        },
        {
          "name": "type",
          "type": "string",
          "description": "类型，例如：浏览量、点击量、购买量等，用于区分不同的指标类型"
        },
        {
          "name": "value",
          "type": "number",
          "description": "数值，记录该指标的具体数值"
        },
        {
          "name": "create_time",
          "type": "date",
          "description": "创建时间，记录该罗盘数据创建的时间"
        }
      ]
    },
    {
      "name": "admin_ssh_coupon_templates",
      "keywords": [
        "管理后台",
        "优惠券",
        "优惠券模板",
        "促销",
        "营销"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的优惠券模板"
        },
        {
          "name": "code",
          "type": "string",
          "description": "优惠券代码，用于用户兑换或识别优惠券"
        },
        {
          "name": "name",
          "type": "string",
          "description": "优惠券名称，用于在管理界面上标识该优惠券模板"
        },
        {
          "name": "description",
          "type": "string",
          "description": "优惠券描述，详细说明该优惠券的使用规则和限制"
        },
        {
          "name": "amount",
          "type": "number",
          "description": "优惠金额，优惠券的面值"
        },
        {
          "name": "exchange_amount",
          "type": "number",
          "description": "兑换金额，用户需要消费满多少金额才能使用该优惠券"
        },
        {
          "name": "is_valid",
          "type": "boolean",
          "description": "是否有效，true表示有效，false表示无效，用于控制优惠券模板是否可用"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该优惠券模板的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该优惠券模板最后一次更新的时间"
        },
        {
          "name": "end_time",
          "type": "string",
          "description": "结束时间，优惠券的有效截止时间"
        },
        {
          "name": "start_time",
          "type": "string",
          "description": "开始时间，优惠券的有效起始时间"
        },
        {
          "name": "admin_id",
          "type": "string",
          "description": "管理员ID，关联管理员表，记录创建该优惠券模板的管理员"
        },
        {
          "name": "count",
          "type": "number",
          "description": "发行数量，该优惠券模板可以生成的优惠券总数"
        },
        {
          "name": "type",
          "type": "string",
          "description": "优惠券类型，例如：满减券、折扣券等"
        },
        {
          "name": "discount",
          "type": "string",
          "description": "折扣，折扣券的折扣比例"
        },
        {
          "name": "date",
          "type": "string",
          "description": "有效日期，优惠券的有效天数"
        },
        {
          "name": "duration",
          "type": "string",
          "description": "持续时间，优惠券的有效时长"
        },
        {
          "name": "time",
          "type": "string",
          "description": "有效时间，优惠券的有效时间段"
        },
        {
          "name": "member_number",
          "type": "number",
          "description": "会员等级，可以使用该优惠券的会员等级"
        },
        {
          "name": "sort",
          "type": "number",
          "description": "排序，用于控制优惠券在列表中的展示顺序"
        },
        {
          "name": "limitCount",
          "type": "number",
          "description": "每人限领数量，限制每个用户可以领取的优惠券数量"
        },
        {
          "name": "limitDay",
          "type": "number",
          "description": "每日限领数量，限制每天可以领取的优惠券数量"
        },
        {
          "name": "shop_id",
          "type": "string",
          "description": "店铺ID，关联店铺表，指定该优惠券只能在哪个店铺使用"
        },
        {
          "name": "is_miniprogram",
          "type": "boolean",
          "description": "是否小程序专用，true表示只能在小程序中使用，false表示不限制"
        }
      ]
    },
    {
      "name": "admin_ssh_goods",
      "keywords": [
        "管理后台",
        "商品",
        "商品管理",
        "电商"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的商品"
        },
        {
          "name": "name",
          "type": "string",
          "description": "商品名称，用于在界面上展示"
        },
        {
          "name": "cover_image",
          "type": "string",
          "description": "封面图片，用于在商品列表中展示"
        },
        {
          "name": "description",
          "type": "string",
          "description": "商品描述，对商品的简单描述"
        },
        {
          "name": "price",
          "type": "number",
          "description": "商品价格，商品的销售价格"
        },
        {
          "name": "status",
          "type": "number",
          "description": "商品状态，例如：上架、下架、待审核等"
        },
        {
          "name": "stock",
          "type": "number",
          "description": "商品库存，商品的剩余库存数量"
        },
        {
          "name": "type_id",
          "type": "string",
          "description": "商品类型ID，关联商品类型表"
        },
        {
          "name": "display_ids",
          "type": "array",
          "description": "展示ID列表，关联商品展示表，用于控制商品在哪些位置展示"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录商品创建的时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录商品最后一次更新的时间"
        },
        {
          "name": "shop_id",
          "type": "string",
          "description": "店铺ID，关联店铺表，指定该商品属于哪个店铺"
        }
      ]
    },
    {
      "name": "removed_activity_members",
      "keywords": [
        "活动",
        "成员",
        "移除",
        "退款",
        "用户管理"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的移除记录"
        },
        {
          "name": "activity_id",
          "type": "string",
          "description": "活动ID，关联活动表，记录该成员被移除的活动"
        },
        {
          "name": "openid",
          "type": "string",
          "description": "用户openid，用户的唯一标识"
        },
        {
          "name": "order_number",
          "type": "null",
          "description": "订单号，用户参与活动的订单号，可能为空"
        },
        {
          "name": "payment_status",
          "type": "number",
          "description": "支付状态，0表示未支付，1表示已支付"
        },
        {
          "name": "avatar",
          "type": "string",
          "description": "用户头像，用户的头像URL"
        },
        {
          "name": "nickname",
          "type": "string",
          "description": "用户昵称，用户的昵称"
        },
        {
          "name": "avatar_url",
          "type": "string",
          "description": "用户头像URL，用户的头像URL"
        },
        {
          "name": "join_time",
          "type": "date",
          "description": "加入时间，用户参与活动的时间"
        },
        {
          "name": "activity_name",
          "type": "string",
          "description": "活动名称，用户参与的活动名称"
        },
        {
          "name": "activity_fee",
          "type": "number",
          "description": "活动费用，用户参与活动支付的费用"
        },
        {
          "name": "remove_time",
          "type": "date",
          "description": "移除时间，用户被移除活动的时间"
        },
        {
          "name": "operator",
          "type": "string",
          "description": "操作人，执行移除操作的管理员或用户"
        },
        {
          "name": "is_refunded",
          "type": "boolean",
          "description": "是否已退款，true表示已退款，false表示未退款"
        },
        {
          "name": "update_time",
          "type": "date",
          "description": "更新时间，记录该移除记录最后一次更新的时间"
        }
      ]
    },
    {
      "name": "payment_records",
      "keywords": [
        "支付",
        "订单",
        "微信支付",
        "退款",
        "交易"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的支付记录"
        },
        {
          "name": "order_id",
          "type": "string",
          "description": "订单ID，关联订单表，记录该支付记录属于哪个订单"
        },
        {
          "name": "openid",
          "type": "string",
          "description": "用户openid，用户的唯一标识"
        },
        {
          "name": "total_fee",
          "type": "number",
          "description": "支付金额，订单的总金额，单位为分"
        },
        {
          "name": "prepay_id",
          "type": "string",
          "description": "预支付ID，微信支付返回的预支付ID"
        },
        {
          "name": "status",
          "type": "number",
          "description": "支付状态，0表示待支付，1表示已支付，2表示已退款，3表示支付失败"
        },
        {
          "name": "create_time",
          "type": "date",
          "description": "创建时间，记录支付记录创建的时间"
        },
        {
          "name": "update_time",
          "type": "date",
          "description": "更新时间，记录支付记录最后一次更新的时间"
        },
        {
          "name": "timeout_time",
          "type": "date",
          "description": "超时时间，订单支付的超时时间"
        },
        {
          "name": "refund_fee",
          "type": "number",
          "description": "退款金额，订单的退款金额，单位为分"
        },
        {
          "name": "transaction_id",
          "type": "null",
          "description": "微信支付订单号，微信支付返回的订单号，可能为空"
        },
        {
          "name": "refund_id",
          "type": "null",
          "description": "微信退款单号，微信支付返回的退款单号，可能为空"
        },
        {
          "name": "order_type",
          "type": "number",
          "description": "订单类型，用于区分不同类型的订单，例如：商品订单、活动订单等"
        }
      ]
    },
    {
      "name": "refund_records",
      "keywords": [
        "退款",
        "订单",
        "微信退款",
        "售后"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的退款记录"
        },
        {
          "name": "order_id",
          "type": "string",
          "description": "订单ID，关联订单表，记录该退款记录属于哪个订单"
        },
        {
          "name": "refund_id",
          "type": "string",
          "description": "退款单号，微信支付返回的退款单号"
        },
        {
          "name": "refund_fee",
          "type": "number",
          "description": "退款金额，退款的金额，单位为分"
        },
        {
          "name": "reason",
          "type": "string",
          "description": "退款原因，用户申请退款的原因"
        },
        {
          "name": "openid",
          "type": "string",
          "description": "用户openid，用户的唯一标识"
        },
        {
          "name": "status",
          "type": "number",
          "description": "退款状态，0表示待处理，1表示已退款，2表示退款失败"
        },
        {
          "name": "create_time",
          "type": "date",
          "description": "创建时间，记录退款记录创建的时间"
        },
        {
          "name": "update_time",
          "type": "date",
          "description": "更新时间，记录退款记录最后一次更新的时间"
        },
        {
          "name": "order_type",
          "type": "number",
          "description": "订单类型，用于区分不同类型的订单，例如：商品订单、活动订单等"
        },
        {
          "name": "operator",
          "type": "string",
          "description": "操作人，执行退款操作的管理员或用户"
        }
      ]
    },
    {
      "name": "orders",
      "keywords": [
        "订单",
        "商品",
        "支付",
        "交易",
        "电商"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的订单"
        },
        {
          "name": "order_number",
          "type": "string",
          "description": "订单号，唯一的订单编号"
        },
        {
          "name": "goods_name",
          "type": "string",
          "description": "商品名称，订单中包含的商品名称"
        },
        {
          "name": "goods_price",
          "type": "number",
          "description": "商品价格，订单中商品的单价"
        },
        {
          "name": "goods_cover",
          "type": "string",
          "description": "商品封面，订单中商品的封面图片URL"
        },
        {
          "name": "goods_type",
          "type": "string",
          "description": "商品类型，订单中商品的类型"
        },
        {
          "name": "coupons",
          "type": "array",
          "description": "优惠券列表，订单使用的优惠券信息"
        },
        {
          "name": "order_type",
          "type": "number",
          "description": "订单类型，用于区分不同类型的订单，例如：商品订单、活动订单等"
        },
        {
          "name": "payment_amount",
          "type": "number",
          "description": "支付金额，订单实际支付的金额"
        },
        {
          "name": "status",
          "type": "number",
          "description": "订单状态，例如：待支付、已支付、已发货、已完成、已取消等"
        },
        {
          "name": "payment_status",
          "type": "number",
          "description": "支付状态，0表示未支付，1表示已支付"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，关联用户表，记录该订单属于哪个用户"
        },
        {
          "name": "goods_id",
          "type": "string",
          "description": "商品ID，关联商品表，记录该订单购买的商品"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录订单创建的时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录订单最后一次更新的时间"
        },
        {
          "name": "update_time",
          "type": "date",
          "description": "更新时间，记录订单最后一次更新的时间"
        },
        {
          "name": "activity_id",
          "type": "string",
          "description": "活动ID，关联活动表，如果订单是活动订单，则记录活动ID"
        }
      ]
    },
    {
      "name": "activity_members",
      "keywords": [
        "活动",
        "成员",
        "参与者",
        "用户"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的活动成员记录"
        },
        {
          "name": "activity_id",
          "type": "string",
          "description": "活动ID，关联活动表，记录该成员参与的活动"
        },
        {
          "name": "nickname",
          "type": "string",
          "description": "用户昵称，用户的昵称"
        },
        {
          "name": "openid",
          "type": "string",
          "description": "用户openid，用户的唯一标识"
        },
        {
          "name": "avatar",
          "type": "string",
          "description": "用户头像，用户的头像URL"
        },
        {
          "name": "payment_status",
          "type": "number",
          "description": "支付状态，0表示未支付，1表示已支付"
        },
        {
          "name": "join_time",
          "type": "date",
          "description": "加入时间，用户参与活动的时间"
        },
        {
          "name": "update_time",
          "type": "date",
          "description": "更新时间，记录该成员记录最后一次更新的时间"
        }
      ]
    },
    {
      "name": "exchange_list",
      "keywords": [
        "兑换",
        "积分",
        "礼品",
        "用户"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的兑换记录"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，关联用户表，记录该兑换记录属于哪个用户"
        },
        {
          "name": "template_id",
          "type": "string",
          "description": "模板ID，关联兑换模板表，记录该兑换记录使用的哪个模板"
        },
        {
          "name": "name",
          "type": "string",
          "description": "兑换名称，兑换的礼品或商品的名称"
        },
        {
          "name": "coins",
          "type": "number",
          "description": "所需积分，兑换该礼品或商品所需的积分数量"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录兑换记录创建的时间"
        }
      ]
    },
    {
      "name": "admin_ssh_roles",
      "keywords": [
        "管理后台",
        "角色",
        "权限管理",
        "用户组"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的角色"
        },
        {
          "name": "name",
          "type": "string",
          "description": "角色名称，用于在管理界面上标识该角色"
        },
        {
          "name": "description",
          "type": "string",
          "description": "角色描述，详细说明该角色的职责和权限范围"
        },
        {
          "name": "permissions",
          "type": "array",
          "description": "权限列表，该角色拥有的权限ID列表，关联权限表"
        },
        {
          "name": "status",
          "type": "number",
          "description": "状态，0表示禁用，1表示启用，用于控制该角色是否可用"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该角色的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该角色最后一次更新的时间"
        }
      ]
    },
    {
      "name": "chat",
      "keywords": [
        "聊天",
        "消息",
        "会话"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "object",
          "description": "唯一标识符，用于区分不同的聊天记录"
        }
      ]
    },
    {
      "name": "group_tag",
      "keywords": [
        "团购",
        "标签",
        "分类"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的团购标签"
        },
        {
          "name": "name",
          "type": "string",
          "description": "标签名称，用于在界面上展示"
        }
      ]
    },
    {
      "name": "admin_ssh_users",
      "keywords": [
        "管理后台",
        "用户",
        "管理员",
        "权限管理"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的用户"
        },
        {
          "name": "username",
          "type": "string",
          "description": "用户名，用于登录管理后台"
        },
        {
          "name": "password_hash",
          "type": "string",
          "description": "密码哈希值，用于存储用户密码的哈希值"
        },
        {
          "name": "roles",
          "type": "array",
          "description": "角色列表，该用户拥有的角色ID列表，关联角色表"
        },
        {
          "name": "status",
          "type": "number",
          "description": "状态，0表示禁用，1表示启用，用于控制该用户是否可以登录"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该用户的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该用户最后一次更新的时间"
        },
        {
          "name": "is_active",
          "type": "boolean",
          "description": "是否激活，true表示已激活，false表示未激活，用于控制该用户是否可以登录"
        }
      ]
    },
    {
      "name": "admin_ssh_coupon_events",
      "keywords": [
        "管理后台",
        "优惠券",
        "事件",
        "日志"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的优惠券事件记录"
        },
        {
          "name": "event_type",
          "type": "string",
          "description": "事件类型，例如：创建、修改、删除等，用于区分不同的事件类型"
        },
        {
          "name": "template_id",
          "type": "string",
          "description": "模板ID，关联优惠券模板表，记录该事件与哪个优惠券模板相关"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该事件的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该事件最后一次更新的时间"
        }
      ]
    },
    {
      "name": "admin_ssh_event_triggers",
      "keywords": [
        "管理后台",
        "事件",
        "触发器",
        "用户行为"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的事件触发器记录"
        },
        {
          "name": "event_id",
          "type": "string",
          "description": "事件ID，关联事件表，记录触发的事件"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，关联用户表，记录触发事件的用户"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录事件触发的时间"
        }
      ]
    },
    {
      "name": "calendar_activities",
      "keywords": [
        "日历",
        "活动",
        "日程",
        "预约"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的日历活动记录"
        },
        {
          "name": "calendar_date",
          "type": "number",
          "description": "日历日期，Unix时间戳格式的日期"
        },
        {
          "name": "activity_id",
          "type": "string",
          "description": "活动ID，关联活动表，记录该日历活动对应的活动"
        },
        {
          "name": "tags",
          "type": "string",
          "description": "标签，活动的标签，用于分类和搜索"
        },
        {
          "name": "end_time",
          "type": "date",
          "description": "结束时间，活动的结束时间"
        },
        {
          "name": "current_members",
          "type": "number",
          "description": "当前成员数，当前参与活动的人数"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录日历活动创建的时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录日历活动最后一次更新的时间"
        },
        {
          "name": "date",
          "type": "string",
          "description": "日期，活动的日期，字符串格式"
        },
        {
          "name": "member_number",
          "type": "number",
          "description": "成员人数，活动限制的成员人数"
        },
        {
          "name": "time",
          "type": "string",
          "description": "时间，活动的时间，字符串格式"
        },
        {
          "name": "duration",
          "type": "string",
          "description": "持续时间，活动的持续时间，字符串格式"
        },
        {
          "name": "show",
          "type": "string",
          "description": "是否显示，用于控制活动是否在前台展示"
        },
        {
          "name": "shop_id",
          "type": "string",
          "description": "店铺ID，关联店铺表，指定该活动属于哪个店铺"
        },
        {
          "name": "owner_id",
          "type": "string",
          "description": "所有者ID，关联用户表，记录创建该日历活动的用户"
        }
      ]
    },
    {
      "name": "admin_ssh_menus",
      "keywords": [
        "管理后台",
        "菜单",
        "导航",
        "权限管理"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的菜单"
        },
        {
          "name": "name",
          "type": "string",
          "description": "菜单名称，用于在管理界面上展示"
        },
        {
          "name": "path",
          "type": "string",
          "description": "菜单路径，用于路由跳转"
        },
        {
          "name": "icon",
          "type": "string",
          "description": "菜单图标，用于在管理界面上展示"
        },
        {
          "name": "permission_code",
          "type": "string",
          "description": "权限代码，关联权限表，用于控制该菜单的访问权限"
        },
        {
          "name": "sort_order",
          "type": "number",
          "description": "排序，用于控制菜单在列表中的展示顺序，数值越小越靠前"
        },
        {
          "name": "parent_id",
          "type": "null",
          "description": "父菜单ID，关联菜单表，用于构建菜单的层级关系，如果为空则表示顶级菜单"
        },
        {
          "name": "status",
          "type": "number",
          "description": "状态，0表示禁用，1表示启用，用于控制该菜单是否显示"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该菜单的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该菜单最后一次更新的时间"
        }
      ]
    },
    {
      "name": "users",
      "keywords": [
        "用户",
        "会员",
        "客户",
        "微信用户"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的用户"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，自定义的用户ID"
        },
        {
          "name": "username",
          "type": "string",
          "description": "用户名，用户的名称"
        },
        {
          "name": "openid",
          "type": "string",
          "description": "用户openid，微信用户的唯一标识"
        },
        {
          "name": "avatar",
          "type": "string",
          "description": "用户头像，用户的头像URL"
        },
        {
          "name": "status",
          "type": "number",
          "description": "用户状态，0表示正常，1表示禁用"
        },
        {
          "name": "points",
          "type": "number",
          "description": "积分，用户的积分数量"
        },
        {
          "name": "create_time",
          "type": "date",
          "description": "创建时间，记录用户创建的时间"
        },
        {
          "name": "update_time",
          "type": "date",
          "description": "更新时间，记录用户最后一次更新的时间"
        },
        {
          "name": "mobile",
          "type": "string",
          "description": "手机号，用户的手机号码"
        },
        {
          "name": "doll_points",
          "type": "number",
          "description": "娃娃币，用户的娃娃币数量"
        },
        {
          "name": "joker_points",
          "type": "string",
          "description": "小丑币，用户的小丑币数量"
        },
        {
          "name": "remark",
          "type": "string",
          "description": "备注，管理员对用户的备注信息"
        },
        {
          "name": "activity_count",
          "type": "number",
          "description": "参与活动次数，用户参与活动的次数"
        },
        {
          "name": "coupon_used_count",
          "type": "number",
          "description": "优惠券使用次数，用户使用的优惠券次数"
        },
        {
          "name": "miniapp_opens",
          "type": "number",
          "description": "小程序打开次数，用户打开小程序的次数"
        },
        {
          "name": "order_count",
          "type": "number",
          "description": "订单数量，用户的订单数量"
        },
        {
          "name": "total_amount",
          "type": "number",
          "description": "消费总额，用户的消费总金额"
        },
        {
          "name": "visit_count",
          "type": "number",
          "description": "访问次数，用户访问网站或小程序的次数"
        },
        {
          "name": "conversation_id",
          "type": "string",
          "description": "会话ID，用户与客服的会话ID"
        },
        {
          "name": "customer_service",
          "type": "string",
          "description": "客服，负责该用户的客服人员"
        },
        {
          "name": "follower",
          "type": "string",
          "description": "关注者，用户的关注者数量"
        },
        {
          "name": "isCrmUsed",
          "type": "boolean",
          "description": "是否已使用CRM，true表示已使用，false表示未使用"
        },
        {
          "name": "referrer_uid",
          "type": "string",
          "description": "推荐人UID，推荐该用户注册的用户的ID"
        },
        {
          "name": "tag",
          "type": "string",
          "description": "标签，用户的标签，用于分类和搜索"
        },
        {
          "name": "last_contact_time",
          "type": "date",
          "description": "最后联系时间，最后一次与用户联系的时间"
        }
      ]
    },
    {
      "name": "admin_ssh_goods_types",
      "keywords": [
        "管理后台",
        "商品类型",
        "商品分类",
        "商品管理"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的商品类型"
        },
        {
          "name": "name",
          "type": "string",
          "description": "类型名称，用于在管理界面上标识该商品类型"
        },
        {
          "name": "description",
          "type": "string",
          "description": "类型描述，详细说明该商品类型的特点和适用范围"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该商品类型的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该商品类型最后一次更新的时间"
        }
      ]
    },
    {
      "name": "point_records",
      "keywords": [
        "积分",
        "用户",
        "记录",
        "明细"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的积分记录"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，关联用户表，记录该积分记录属于哪个用户"
        },
        {
          "name": "point",
          "type": "number",
          "description": "积分值，本次积分变动的数量，可正可负"
        },
        {
          "name": "change_type",
          "type": "number",
          "description": "变动类型，0表示增加，1表示减少"
        },
        {
          "name": "change_reason",
          "type": "string",
          "description": "变动原因，积分变动的原因，例如：签到、购物、兑换等"
        },
        {
          "name": "create_time",
          "type": "date",
          "description": "创建时间，记录积分记录创建的时间"
        }
      ]
    },
    {
      "name": "admin_ssh_coupons",
      "keywords": [
        "管理后台",
        "优惠券",
        "用户",
        "促销"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的优惠券"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，关联用户表，记录该优惠券属于哪个用户"
        },
        {
          "name": "template_id",
          "type": "string",
          "description": "模板ID，关联优惠券模板表，记录该优惠券由哪个模板生成"
        },
        {
          "name": "name",
          "type": "string",
          "description": "优惠券名称，用于在界面上展示"
        },
        {
          "name": "description",
          "type": "string",
          "description": "优惠券描述，详细说明该优惠券的使用规则和限制"
        },
        {
          "name": "amount",
          "type": "number",
          "description": "优惠金额，优惠券的面值"
        },
        {
          "name": "status",
          "type": "number",
          "description": "状态，0表示未使用，1表示已使用，2表示已过期"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该优惠券的创建时间"
        },
        {
          "name": "updated_at",
          "type": "date",
          "description": "更新时间，记录该优惠券最后一次更新的时间"
        },
        {
          "name": "admin_id",
          "type": "string",
          "description": "管理员ID，关联管理员表，记录发放该优惠券的管理员"
        },
        {
          "name": "verification_time",
          "type": "string",
          "description": "核销时间，优惠券被使用的时间"
        }
      ]
    },
    {
      "name": "calendar_activitie_members",
      "keywords": [
        "日历",
        "活动",
        "成员",
        "参与者"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的日历活动成员记录"
        },
        {
          "name": "nickname",
          "type": "string",
          "description": "用户昵称，用户的昵称"
        },
        {
          "name": "avatar",
          "type": "string",
          "description": "用户头像，用户的头像URL"
        },
        {
          "name": "mobile",
          "type": "string",
          "description": "手机号，用户的手机号码"
        },
        {
          "name": "group_id",
          "type": "string",
          "description": "分组ID，用于将成员分组"
        },
        {
          "name": "user_id",
          "type": "string",
          "description": "用户ID，关联用户表，记录该成员属于哪个用户"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录该成员加入日历活动的时间"
        }
      ]
    },
    {
      "name": "crm_form",
      "keywords": [
        "CRM",
        "客户",
        "表单",
        "销售线索"
      ],
      "fields": [
        {
          "name": "_id",
          "type": "string",
          "description": "唯一标识符，用于区分不同的CRM表单记录"
        },
        {
          "name": "children",
          "type": "array",
          "description": "子表单数据，用于存储关联的子表单信息"
        },
        {
          "name": "customer_name",
          "type": "string",
          "description": "客户姓名，客户的姓名"
        },
        {
          "name": "customer_uid",
          "type": "string",
          "description": "客户UID，关联用户表，记录该表单属于哪个客户"
        },
        {
          "name": "customer_phone",
          "type": "string",
          "description": "客户电话，客户的联系电话"
        },
        {
          "name": "intent_date",
          "type": "string",
          "description": "意向日期，客户表达意向的日期"
        },
        {
          "name": "expected_people",
          "type": "string",
          "description": "预计人数，客户预计参与的人数"
        },
        {
          "name": "progress",
          "type": "string",
          "description": "进度，销售线索的当前进度阶段"
        },
        {
          "name": "deal_date",
          "type": "string",
          "description": "成交日期，预计或实际成交的日期"
        },
        {
          "name": "demand",
          "type": "string",
          "description": "需求，客户的需求描述"
        },
        {
          "name": "product_item",
          "type": "string",
          "description": "产品项目，客户感兴趣的产品或服务项目"
        },
        {
          "name": "budget",
          "type": "string",
          "description": "预算，客户的预算范围"
        },
        {
          "name": "deposit",
          "type": "string",
          "description": "定金，客户支付的定金金额"
        },
        {
          "name": "age_group",
          "type": "string",
          "description": "年龄段，客户的年龄段"
        },
        {
          "name": "residence",
          "type": "string",
          "description": "居住地，客户的居住地"
        },
        {
          "name": "remarks",
          "type": "string",
          "description": "备注，销售人员对客户的备注信息"
        },
        {
          "name": "referrer_name",
          "type": "string",
          "description": "推荐人姓名，推荐人的姓名"
        },
        {
          "name": "referrer_uid",
          "type": "null",
          "description": "推荐人UID，关联用户表，记录推荐人"
        },
        {
          "name": "referrer_phone",
          "type": "string",
          "description": "推荐人电话，推荐人的联系电话"
        },
        {
          "name": "customer_service",
          "type": "string",
          "description": "客服，负责跟进该客户的客服人员"
        },
        {
          "name": "follower",
          "type": "string",
          "description": "跟进人，负责跟进该客户的销售人员"
        },
        {
          "name": "call_date",
          "type": "string",
          "description": "回访日期，下次计划回访客户的日期"
        },
        {
          "name": "call_time",
          "type": "string",
          "description": "回访时间，下次计划回访客户的时间"
        },
        {
          "name": "room_preference",
          "type": "string",
          "description": "房间偏好，客户对房间的偏好"
        },
        {
          "name": "has_children",
          "type": "string",
          "description": "是否有孩子，客户是否有孩子"
        },
        {
          "name": "source_platform",
          "type": "string",
          "description": "来源平台，客户的来源平台"
        },
        {
          "name": "created_at",
          "type": "date",
          "description": "创建时间，记录表单创建的时间"
        },
        {
          "name": "tag",
          "type": "string",
          "description": "标签，客户的标签，用于分类和搜索"
        },
        {
          "name": "last_contact_time",
          "type": "date",
          "description": "最后联系时间，最后一次与客户联系的时间"
        },
        {
          "name": "total_payment",
          "type": "number",
          "description": "总支付金额，客户的总支付金额"
        }
      ]
    }
  ]
};

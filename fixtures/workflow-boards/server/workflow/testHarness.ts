import * as Layer from "effect/Layer";

import * as NodeSqliteClient from "../../../../apps/server/src/persistence/NodeSqliteClient.ts";
import { migration001 } from "../migrations/001_WorkflowSchema.ts";

export const WorkflowSchemaLive = Layer.effectDiscard(migration001.up);

export const TestSql = WorkflowSchemaLive.pipe(Layer.provideMerge(NodeSqliteClient.layerMemory()));

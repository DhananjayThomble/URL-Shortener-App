import { Module } from "@nestjs/common";
import { PublicController } from "./public.controller.js";
import { PublicService } from "./public.service.js";
import { FormsModule } from "../forms/forms.module.js";

/* FormsModule imported rather than the service re-provided, so the public
   form routes and the dashboard's share one instance and one set of rules. */
@Module({ imports: [FormsModule], controllers: [PublicController], providers: [PublicService] })
export class PublicModule {}

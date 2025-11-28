import { PrismaService } from "@/prisma/prisma.service";
import { Permission } from "@generated/client";
import { PermissionScope, PermissionResource } from "@generated/enums";
import { Injectable, Logger, ConflictException, NotFoundException } from "@nestjs/common";
import { CreatePermissionDto } from "../dtos/create-permission.dto";

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createPermission(createPermissionDto: CreatePermissionDto): Promise<Permission> {
    const { name, description, scope, resource, action } = createPermissionDto;

    // Check if permission already exists
    const existing = await this.prisma.permission.findFirst({
      where: {
        scope,
        resource,
        action,
      },
    });

    if (existing) {
      throw new ConflictException('Permission already exists');
    }

    return this.prisma.permission.create({
      data: {
        name,
        description,
        scope,
        resource,
        action,
      },
    });
  }

  async findAllPermissions(): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      orderBy: [{ scope: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
    });
  }

  async findPermissionById(id: string): Promise<Permission> {
    const permission = await this.prisma.permission.findUnique({
      where: { id },
    });

    if (!permission) {
      throw new NotFoundException(`Permission with ID ${id} not found`);
    }

    return permission;
  }

  async findPermissionsByScope(scope: PermissionScope): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      where: { scope },
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
    });
  }

  async findPermissionsByResource(scope: PermissionScope, resource: PermissionResource): Promise<Permission[]> {
    return this.prisma.permission.findMany({
      where: { scope, resource },
      orderBy: { action: 'asc' },
    });
  }

  async deletePermission(id: string): Promise<void> {
    // Check if permission is used by any roles
    const rolePermissions = await this.prisma.rolePermission.count({
      where: { permissionId: id },
    });

    if (rolePermissions > 0) {
      throw new ConflictException('Cannot delete permission that is assigned to roles');
    }

    await this.prisma.permission.delete({
      where: { id },
    });
  }
}
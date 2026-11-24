using Asp.Versioning;
using Asp.Versioning.ApiExplorer;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using TaskFlow.Api.Extensions;

namespace TaskFlow.Api.Tests.Extensions;

public class OpenApiServiceExtensionsTests
{
    private static OpenApiDocumentTransformerContext CreateContext(string documentName)
    {
        return new OpenApiDocumentTransformerContext
        {
            DocumentName = documentName,
            DescriptionGroups = new List<ApiDescriptionGroup>(),
            ApplicationServices = new ServiceCollection().BuildServiceProvider()
        };
    }

    [Fact]
    public async Task ApiVersionDocumentTransformer_TransformAsync_SetsDocumentInfo_WithoutVersionProvider()
    {
        // Arrange
        var transformer = new ApiVersionDocumentTransformer();
        var document = new Microsoft.OpenApi.OpenApiDocument();
        var context = CreateContext("v1");

        // Act
        await transformer.TransformAsync(document, context, CancellationToken.None);

        // Assert
        Assert.NotNull(document.Info);
        Assert.Equal("TaskFlow API", document.Info.Title);
        Assert.Equal("v1", document.Info.Version);
        Assert.Contains("RESTful", document.Info.Description);
    }

    [Fact]
    public async Task ApiVersionDocumentTransformer_TransformAsync_DescribesDeprecation_WhenVersionIsDeprecated()
    {
        // Arrange
        var provider = new Mock<IApiVersionDescriptionProvider>();
        provider.Setup(p => p.ApiVersionDescriptions).Returns(
            [new ApiVersionDescription(new ApiVersion(1, 0), "v1", true)]);
        var transformer = new ApiVersionDocumentTransformer(provider.Object);
        var document = new Microsoft.OpenApi.OpenApiDocument();

        // Act
        await transformer.TransformAsync(document, CreateContext("v1"), CancellationToken.None);

        // Assert
        Assert.Equal("1.0", document.Info.Version);
        Assert.Contains("deprecated", document.Info.Description);
        Assert.DoesNotContain("RESTful", document.Info.Description);
    }

    [Fact]
    public async Task ApiVersionDocumentTransformer_TransformAsync_ReturnsCompletedTask()
    {
        // Arrange
        var transformer = new ApiVersionDocumentTransformer();
        var document = new Microsoft.OpenApi.OpenApiDocument();
        var context = CreateContext("v2");

        // Act
        var task = transformer.TransformAsync(document, context, CancellationToken.None);
        await task;

        // Assert
        Assert.True(task.IsCompleted);
        Assert.Equal("v2", document.Info.Version);
    }
}
